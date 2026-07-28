use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION,
        RECOVERY_POLICY_SEED,
    },
    errors::SocialProtocolError,
    events::RecoveryPolicyConfigured,
    state::{Identity, ProtocolConfig, RecoveryPolicy},
    validation::{checked_increment, checked_next_sequence, validate_recovery_policy},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigureRecoveryPolicyArgs {
    pub expected_identity_sequence: u64,
    pub expected_policy_sequence: u64,
    pub guardians: Vec<Pubkey>,
    pub threshold: u8,
    pub delay_slots: u64,
}

#[derive(Accounts)]
#[instruction(args: ConfigureRecoveryPolicyArgs)]
pub struct ConfigureRecoveryPolicy<'info> {
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
        init_if_needed,
        payer = payer,
        space = RecoveryPolicy::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_POLICY_SEED,
            identity.key().as_ref()
        ],
        bump
    )]
    pub recovery_policy: Account<'info, RecoveryPolicy>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_configure_recovery_policy(
    ctx: Context<ConfigureRecoveryPolicy>,
    args: ConfigureRecoveryPolicyArgs,
) -> Result<()> {
    validate_recovery_policy(
        ctx.accounts.identity.root_authority,
        &args.guardians,
        args.threshold,
        args.delay_slots,
    )?;

    let policy = &ctx.accounts.recovery_policy;
    let current_policy_sequence = if policy.version == 0 {
        0
    } else {
        require_eq!(
            policy.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            policy.config,
            ctx.accounts.config.key(),
            SocialProtocolError::RecoveryPolicySubstitution
        );
        require_keys_eq!(
            policy.identity,
            ctx.accounts.identity.key(),
            SocialProtocolError::RecoveryPolicySubstitution
        );
        policy.policy_sequence
    };
    require_eq!(
        current_policy_sequence,
        args.expected_policy_sequence,
        SocialProtocolError::RecoveryPolicySequenceMismatch
    );

    let configured_at_slot = Clock::get()?.slot;
    let next_policy_sequence = checked_increment(current_policy_sequence)?;
    let next_identity_sequence = checked_next_sequence(
        ctx.accounts.identity.sequence,
        args.expected_identity_sequence,
    )?;
    ctx.accounts.identity.sequence = next_identity_sequence;

    let policy = &mut ctx.accounts.recovery_policy;
    policy.version = ACCOUNT_VERSION;
    policy.config = ctx.accounts.config.key();
    policy.identity = ctx.accounts.identity.key();
    policy.policy_sequence = next_policy_sequence;
    policy.guardians = args.guardians;
    policy.threshold = args.threshold;
    policy.delay_slots = args.delay_slots;
    policy.updated_at_slot = configured_at_slot;
    policy.active = true;
    policy.bump = ctx.bumps.recovery_policy;

    emit!(RecoveryPolicyConfigured {
        event_version: PROTOCOL_VERSION,
        config: ctx.accounts.config.key(),
        identity: ctx.accounts.identity.key(),
        recovery_policy: policy.key(),
        root_authority: ctx.accounts.root_authority.key(),
        policy_sequence: next_policy_sequence,
        identity_sequence: next_identity_sequence,
        root_rotation_count: ctx.accounts.identity.root_rotation_count,
        guardians: policy.guardians.clone(),
        threshold: policy.threshold,
        delay_slots: policy.delay_slots,
        configured_at_slot,
    });
    Ok(())
}
