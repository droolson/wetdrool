use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, PDA_PREFIX, PDA_VERSION, PROTOCOL_VERSION},
    events::ProtocolInitialized,
    state::ProtocolConfig,
};

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = ProtocolConfig::SPACE,
        seeds = [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
    let initialized_at_slot = Clock::get()?.slot;
    let config_key = ctx.accounts.config.key();
    let config = &mut ctx.accounts.config;

    config.version = PROTOCOL_VERSION;
    config.initialized_at_slot = initialized_at_slot;
    config.identity_count = 0;
    config.post_count = 0;
    config.follow_edge_count = 0;
    config.tombstone_count = 0;
    config.delegation_count = 0;
    config.block_edge_count = 0;
    config.community_count = 0;
    config.membership_count = 0;
    config.reaction_reference_count = 0;
    config.bump = ctx.bumps.config;

    emit!(ProtocolInitialized {
        event_version: PROTOCOL_VERSION,
        config: config_key,
        initialized_at_slot,
    });

    Ok(())
}
