use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
        RECOVERY_POLICY_SEED,
    },
    errors::SocialProtocolError,
    events::RecoveryPolicyDisabled,
    state::{Identity, ProtocolConfig, RecoveryPolicy},
    validation::{checked_increment, checked_next_sequence},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DisableRecoveryPolicyArgs {
    pub expected_identity_sequence: u64,
    pub expected_policy_sequence: u64,
}

#[derive(Accounts)]
pub struct DisableRecoveryPolicy<'info> {
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
        has_one = root_authority @ SocialProtocolError::Unauthorized,
        constraint = identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub identity: Account<'info, Identity>,
    #[account(
        mut,
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
    pub root_authority: Signer<'info>,
}

pub fn handle_disable_recovery_policy(
    ctx: Context<DisableRecoveryPolicy>,
    args: DisableRecoveryPolicyArgs,
) -> Result<()> {
    require!(
        ctx.accounts.recovery_policy.active,
        SocialProtocolError::RecoveryPolicyAlreadyDisabled
    );
    require_eq!(
        ctx.accounts.recovery_policy.policy_sequence,
        args.expected_policy_sequence,
        SocialProtocolError::RecoveryPolicySequenceMismatch
    );
    let disabled_at_slot = Clock::get()?.slot;
    let next_policy_sequence = checked_increment(ctx.accounts.recovery_policy.policy_sequence)?;
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    ctx.accounts.identity.sequence = next_identity_sequence;
    ctx.accounts.recovery_policy.policy_sequence = next_policy_sequence;
    ctx.accounts.recovery_policy.updated_at_slot = disabled_at_slot;
    ctx.accounts.recovery_policy.active = false;

    emit!(RecoveryPolicyDisabled {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        recovery_policy: ctx.accounts.recovery_policy.key(),
        root_authority: ctx.accounts.root_authority.key(),
        policy_sequence: next_policy_sequence,
        identity_sequence: next_identity_sequence,
        root_rotation_count: ctx.accounts.identity.root_rotation_count,
        disabled_at_slot,
    });
    Ok(())
}
