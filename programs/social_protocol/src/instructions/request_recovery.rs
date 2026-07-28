use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, NONCE_BYTES, PDA_PREFIX, PDA_VERSION,
        PROTOCOL_VERSION, RECOVERY_POLICY_SEED, RECOVERY_REQUEST_SEED,
    },
    errors::SocialProtocolError,
    events::RecoveryRequested,
    state::{Identity, ProtocolConfig, RecoveryPolicy, RecoveryRequest, RecoveryRequestState},
    validation::{
        checked_recovery_execute_after, record_recovery_approval, recovery_guardian_index,
        validate_recovery_policy, validate_recovery_target,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RequestRecoveryArgs {
    pub request_nonce: [u8; NONCE_BYTES],
    pub expected_policy_sequence: u64,
    pub expected_identity_sequence: u64,
    pub expected_root_rotation_count: u64,
    pub target_root_authority: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: RequestRecoveryArgs)]
pub struct RequestRecovery<'info> {
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
        init,
        payer = payer,
        space = RecoveryRequest::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_REQUEST_SEED,
            identity.key().as_ref(),
            args.request_nonce.as_ref()
        ],
        bump
    )]
    pub recovery_request: Account<'info, RecoveryRequest>,
    pub guardian: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_request_recovery(
    ctx: Context<RequestRecovery>,
    args: RequestRecoveryArgs,
) -> Result<()> {
    require!(
        args.request_nonce.iter().any(|byte| *byte != 0),
        SocialProtocolError::InvalidRecoveryNonce
    );
    require!(
        ctx.accounts.recovery_policy.active,
        SocialProtocolError::RecoveryPolicyDisabled
    );
    require_eq!(
        ctx.accounts.recovery_policy.policy_sequence,
        args.expected_policy_sequence,
        SocialProtocolError::RecoveryPolicySequenceMismatch
    );
    require_eq!(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
        SocialProtocolError::SequenceMismatch
    );
    require_eq!(
        ctx.accounts.identity.root_rotation_count,
        args.expected_root_rotation_count,
        SocialProtocolError::RecoveryRequestStaleEpoch
    );
    validate_recovery_policy(
        ctx.accounts.identity.root_authority,
        &ctx.accounts.recovery_policy.guardians,
        ctx.accounts.recovery_policy.threshold,
        ctx.accounts.recovery_policy.delay_slots,
    )?;
    validate_recovery_target(
        ctx.accounts.identity.root_authority,
        args.target_root_authority,
    )?;
    let guardian_index =
        recovery_guardian_index(&ctx.accounts.recovery_policy, ctx.accounts.guardian.key())?;
    let requested_at_slot = Clock::get()?.slot;
    let execute_after_slot = checked_recovery_execute_after(
        requested_at_slot,
        ctx.accounts.recovery_policy.delay_slots,
    )?;
    let guardian_count = u8::try_from(ctx.accounts.recovery_policy.guardians.len())
        .map_err(|_| error!(SocialProtocolError::ArithmeticOverflow))?;

    let request = &mut ctx.accounts.recovery_request;
    request.version = ACCOUNT_VERSION;
    request.config = ctx.accounts.config.key();
    request.identity = ctx.accounts.identity.key();
    request.recovery_policy = ctx.accounts.recovery_policy.key();
    request.request_nonce = args.request_nonce;
    request.policy_sequence = ctx.accounts.recovery_policy.policy_sequence;
    request.current_root_authority = ctx.accounts.identity.root_authority;
    request.identity_sequence = ctx.accounts.identity.sequence;
    request.root_rotation_count = ctx.accounts.identity.root_rotation_count;
    request.target_root_authority = args.target_root_authority;
    request.requesting_guardian = ctx.accounts.guardian.key();
    request.threshold = ctx.accounts.recovery_policy.threshold;
    request.guardian_count = guardian_count;
    request.approvals_mask = 0;
    request.approval_count = 0;
    request.requested_at_slot = requested_at_slot;
    request.execute_after_slot = execute_after_slot;
    request.state = RecoveryRequestState::Pending;
    request.terminal_at_slot = None;
    request.bump = ctx.bumps.recovery_request;
    record_recovery_approval(request, guardian_index)?;

    emit!(RecoveryRequested {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        recovery_policy: ctx.accounts.recovery_policy.key(),
        recovery_request: request.key(),
        requesting_guardian: ctx.accounts.guardian.key(),
        request_nonce: request.request_nonce,
        policy_sequence: request.policy_sequence,
        current_root_authority: request.current_root_authority,
        identity_sequence: request.identity_sequence,
        root_rotation_count: request.root_rotation_count,
        target_root_authority: request.target_root_authority,
        threshold: request.threshold,
        guardian_count: request.guardian_count,
        approval_count: request.approval_count,
        requested_at_slot,
        execute_after_slot,
    });
    Ok(())
}
