use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
        RECOVERY_POLICY_SEED, RECOVERY_REQUEST_SEED,
    },
    errors::SocialProtocolError,
    events::RecoveryApproved,
    state::{Identity, ProtocolConfig, RecoveryPolicy, RecoveryRequest},
    validation::{
        record_recovery_approval, recovery_guardian_index, validate_recovery_request_current,
    },
};

#[derive(Accounts)]
pub struct ApproveRecovery<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            identity.origin_authority.as_ref(),
            identity.identity_nonce.as_ref()
        ],
        bump = identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub identity: Account<'info, Identity>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_POLICY_SEED,
            identity.key().as_ref()
        ],
        bump = recovery_policy.bump,
        has_one = config @ SocialProtocolError::RecoveryPolicySubstitution,
        has_one = identity @ SocialProtocolError::RecoveryPolicySubstitution,
        constraint = recovery_policy.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub recovery_policy: Account<'info, RecoveryPolicy>,
    #[account(
        mut,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_REQUEST_SEED,
            identity.key().as_ref(),
            recovery_request.request_nonce.as_ref()
        ],
        bump = recovery_request.bump,
        has_one = config @ SocialProtocolError::RecoveryRequestSubstitution,
        has_one = identity @ SocialProtocolError::RecoveryRequestSubstitution,
        has_one = recovery_policy @ SocialProtocolError::RecoveryRequestSubstitution,
        constraint = recovery_request.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub recovery_request: Account<'info, RecoveryRequest>,
    pub guardian: Signer<'info>,
}

pub fn handle_approve_recovery(ctx: Context<ApproveRecovery>) -> Result<()> {
    validate_recovery_request_current(
        &ctx.accounts.identity,
        &ctx.accounts.recovery_policy,
        &ctx.accounts.recovery_request,
    )?;
    let guardian_index =
        recovery_guardian_index(&ctx.accounts.recovery_policy, ctx.accounts.guardian.key())?;
    let approval_count =
        record_recovery_approval(&mut ctx.accounts.recovery_request, guardian_index)?;
    let approved_at_slot = Clock::get()?.slot;

    emit!(RecoveryApproved {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        recovery_policy: ctx.accounts.recovery_policy.key(),
        recovery_request: ctx.accounts.recovery_request.key(),
        guardian: ctx.accounts.guardian.key(),
        guardian_index,
        policy_sequence: ctx.accounts.recovery_request.policy_sequence,
        approval_count,
        threshold: ctx.accounts.recovery_request.threshold,
        approved_at_slot,
    });
    Ok(())
}
