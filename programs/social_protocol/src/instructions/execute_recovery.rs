use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
        RECOVERY_POLICY_SEED, RECOVERY_REQUEST_SEED,
    },
    errors::SocialProtocolError,
    events::{RecoveryExecuted, RootAuthorityRotated},
    state::{Identity, ProtocolConfig, RecoveryPolicy, RecoveryRequest, RecoveryRequestState},
    validation::{
        checked_increment, checked_recovery_execute_after, validate_recovery_request_current,
        validate_recovery_target,
    },
};

#[derive(Accounts)]
pub struct ExecuteRecovery<'info> {
    #[account(
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump = config.bump,
        constraint = config.version == PROTOCOL_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
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
    pub executor: Signer<'info>,
    pub new_root_authority: Signer<'info>,
}

pub fn handle_execute_recovery(ctx: Context<ExecuteRecovery>) -> Result<()> {
    validate_recovery_request_current(
        &ctx.accounts.identity,
        &ctx.accounts.recovery_policy,
        &ctx.accounts.recovery_request,
    )?;
    validate_recovery_target(
        ctx.accounts.identity.root_authority,
        ctx.accounts.new_root_authority.key(),
    )?;
    require_keys_eq!(
        ctx.accounts.new_root_authority.key(),
        ctx.accounts.recovery_request.target_root_authority,
        SocialProtocolError::InvalidRecoveryTarget
    );
    let expected_execute_after_slot = checked_recovery_execute_after(
        ctx.accounts.recovery_request.requested_at_slot,
        ctx.accounts.recovery_policy.delay_slots,
    )?;
    require_eq!(
        ctx.accounts.recovery_request.execute_after_slot,
        expected_execute_after_slot,
        SocialProtocolError::RecoveryRequestStalePolicy
    );
    let executed_at_slot = Clock::get()?.slot;
    require!(
        executed_at_slot >= ctx.accounts.recovery_request.execute_after_slot,
        SocialProtocolError::RecoveryTooEarly
    );
    require!(
        ctx.accounts.recovery_request.approval_count >= ctx.accounts.recovery_request.threshold,
        SocialProtocolError::RecoveryThresholdNotMet
    );

    let previous_root_authority = ctx.accounts.identity.root_authority;
    let next_identity_sequence = checked_increment(ctx.accounts.identity.sequence)?;
    let next_rotation_count = checked_increment(ctx.accounts.identity.root_rotation_count)?;
    ctx.accounts.identity.sequence = next_identity_sequence;
    ctx.accounts.identity.root_rotation_count = next_rotation_count;
    ctx.accounts.identity.root_authority = ctx.accounts.new_root_authority.key();
    ctx.accounts.recovery_request.state = RecoveryRequestState::Executed;
    ctx.accounts.recovery_request.terminal_at_slot = Some(executed_at_slot);

    emit!(RootAuthorityRotated {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        previous_root_authority,
        new_root_authority: ctx.accounts.new_root_authority.key(),
        identity_sequence: next_identity_sequence,
        rotation_count: next_rotation_count,
        rotated_at_slot: executed_at_slot,
    });
    emit!(RecoveryExecuted {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        recovery_policy: ctx.accounts.recovery_policy.key(),
        recovery_request: ctx.accounts.recovery_request.key(),
        executor: ctx.accounts.executor.key(),
        previous_root_authority,
        new_root_authority: ctx.accounts.new_root_authority.key(),
        policy_sequence: ctx.accounts.recovery_request.policy_sequence,
        approval_count: ctx.accounts.recovery_request.approval_count,
        threshold: ctx.accounts.recovery_request.threshold,
        identity_sequence: next_identity_sequence,
        rotation_count: next_rotation_count,
        executed_at_slot,
    });
    Ok(())
}
