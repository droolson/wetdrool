use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
        RECOVERY_REQUEST_SEED,
    },
    errors::SocialProtocolError,
    events::RecoveryCancelled,
    state::{Identity, ProtocolConfig, RecoveryRequest, RecoveryRequestState},
    validation::checked_next_sequence,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CancelRecoveryArgs {
    pub expected_identity_sequence: u64,
}

#[derive(Accounts)]
pub struct CancelRecovery<'info> {
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
            RECOVERY_REQUEST_SEED,
            identity.key().as_ref(),
            recovery_request.request_nonce.as_ref()
        ],
        bump = recovery_request.bump,
        has_one = config @ SocialProtocolError::RecoveryRequestSubstitution,
        has_one = identity @ SocialProtocolError::RecoveryRequestSubstitution,
        constraint = recovery_request.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub recovery_request: Account<'info, RecoveryRequest>,
    pub root_authority: Signer<'info>,
}

pub fn handle_cancel_recovery(
    ctx: Context<CancelRecovery>,
    args: CancelRecoveryArgs,
) -> Result<()> {
    require!(
        ctx.accounts.recovery_request.state == RecoveryRequestState::Pending
            && ctx.accounts.recovery_request.terminal_at_slot.is_none(),
        SocialProtocolError::RecoveryRequestAlreadyTerminal
    );
    let cancelled_at_slot = Clock::get()?.slot;
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    ctx.accounts.identity.sequence = next_identity_sequence;
    ctx.accounts.recovery_request.state = RecoveryRequestState::Cancelled;
    ctx.accounts.recovery_request.terminal_at_slot = Some(cancelled_at_slot);

    emit!(RecoveryCancelled {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        recovery_policy: ctx.accounts.recovery_request.recovery_policy,
        recovery_request: ctx.accounts.recovery_request.key(),
        cancelled_by_root_authority: ctx.accounts.root_authority.key(),
        target_root_authority: ctx.accounts.recovery_request.target_root_authority,
        policy_sequence: ctx.accounts.recovery_request.policy_sequence,
        identity_sequence: next_identity_sequence,
        root_rotation_count: ctx.accounts.identity.root_rotation_count,
        cancelled_at_slot,
    });
    Ok(())
}
