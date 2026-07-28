use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, CONFIG_SEED, IDENTITY_SEED, PDA_PREFIX, PDA_VERSION, POST_SEED,
        PROTOCOL_VERSION, REACTION_SEED,
    },
    errors::SocialProtocolError,
    events::ReactionStateChanged,
    state::{Identity, PostReference, ProtocolConfig, ReactionReference},
    validation::{checked_increment, checked_next_sequence, validate_reaction_kind},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetReactionArgs {
    pub expected_reactor_sequence: u64,
    pub reaction_kind: u8,
    pub active: bool,
}

#[derive(Accounts)]
#[instruction(args: SetReactionArgs)]
pub struct SetReaction<'info> {
    #[account(
        mut,
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
            reactor_identity.origin_authority.as_ref(),
            reactor_identity.identity_nonce.as_ref()
        ],
        bump = reactor_identity.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        has_one = root_authority @ SocialProtocolError::Unauthorized,
        constraint = reactor_identity.active @ SocialProtocolError::IdentityInactive
    )]
    pub reactor_identity: Account<'info, Identity>,
    #[account(
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            POST_SEED,
            target_post.author_identity.as_ref(),
            target_post.post_nonce.as_ref()
        ],
        bump = target_post.bump,
        has_one = config @ SocialProtocolError::AccountSubstitution,
        constraint = target_post.version == ACCOUNT_VERSION
            @ SocialProtocolError::UnsupportedProtocolVersion
    )]
    pub target_post: Account<'info, PostReference>,
    #[account(
        init_if_needed,
        payer = payer,
        space = ReactionReference::SPACE,
        seeds = [
            PDA_PREFIX,
            PDA_VERSION,
            REACTION_SEED,
            reactor_identity.key().as_ref(),
            target_post.key().as_ref(),
            args.reaction_kind.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub reaction_reference: Account<'info, ReactionReference>,
    pub root_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_reaction(ctx: Context<SetReaction>, args: SetReactionArgs) -> Result<()> {
    validate_reaction_kind(args.reaction_kind)?;
    if args.active {
        require!(
            ctx.accounts.target_post.tombstoned_at_slot.is_none(),
            SocialProtocolError::PostTombstoned
        );
    }

    let updated_at_slot = Clock::get()?.slot;
    let config_key = ctx.accounts.config.key();
    let reactor_identity_key = ctx.accounts.reactor_identity.key();
    let target_post_key = ctx.accounts.target_post.key();
    let is_new = ctx.accounts.reaction_reference.version == 0;

    if is_new {
        require!(args.active, SocialProtocolError::ReactionInactive);
        ctx.accounts.config.reaction_reference_count =
            checked_increment(ctx.accounts.config.reaction_reference_count)?;
        let reaction = &mut ctx.accounts.reaction_reference;
        reaction.version = ACCOUNT_VERSION;
        reaction.config = config_key;
        reaction.reactor_identity = reactor_identity_key;
        reaction.target_post = target_post_key;
        reaction.reaction_kind = args.reaction_kind;
        reaction.state_sequence = 0;
        reaction.reactor_sequence = 0;
        reaction.created_at_slot = updated_at_slot;
        reaction.updated_at_slot = updated_at_slot;
        reaction.active = false;
        reaction.bump = ctx.bumps.reaction_reference;
    } else {
        require_eq!(
            ctx.accounts.reaction_reference.version,
            ACCOUNT_VERSION,
            SocialProtocolError::UnsupportedProtocolVersion
        );
        require_keys_eq!(
            ctx.accounts.reaction_reference.config,
            config_key,
            SocialProtocolError::ReactionSubstitution
        );
        require_keys_eq!(
            ctx.accounts.reaction_reference.reactor_identity,
            reactor_identity_key,
            SocialProtocolError::ReactionSubstitution
        );
        require_keys_eq!(
            ctx.accounts.reaction_reference.target_post,
            target_post_key,
            SocialProtocolError::ReactionSubstitution
        );
        require_eq!(
            ctx.accounts.reaction_reference.reaction_kind,
            args.reaction_kind,
            SocialProtocolError::ReactionSubstitution
        );
    }

    if args.active {
        require!(
            !ctx.accounts.reaction_reference.active,
            SocialProtocolError::AlreadyReacted
        );
    } else {
        require!(
            ctx.accounts.reaction_reference.active,
            SocialProtocolError::ReactionInactive
        );
    }

    let next_reactor_sequence = checked_next_sequence(
        ctx.accounts.reactor_identity.sequence,
        args.expected_reactor_sequence,
    )?;
    let next_reaction_sequence = checked_increment(ctx.accounts.reaction_reference.state_sequence)?;
    ctx.accounts.reactor_identity.sequence = next_reactor_sequence;
    ctx.accounts.reaction_reference.state_sequence = next_reaction_sequence;
    ctx.accounts.reaction_reference.reactor_sequence = next_reactor_sequence;
    ctx.accounts.reaction_reference.updated_at_slot = updated_at_slot;
    ctx.accounts.reaction_reference.active = args.active;

    emit!(ReactionStateChanged {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        reaction_reference: ctx.accounts.reaction_reference.key(),
        reactor_identity: reactor_identity_key,
        target_post: target_post_key,
        authority: ctx.accounts.root_authority.key(),
        reaction_kind: args.reaction_kind,
        reactor_sequence: next_reactor_sequence,
        reaction_state_sequence: next_reaction_sequence,
        active: args.active,
        updated_at_slot,
    });

    Ok(())
}
