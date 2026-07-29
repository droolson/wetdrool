use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod validation;

use instructions::*;

declare_id!("9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD");

#[program]
pub mod social_protocol {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        instructions::initialize_protocol::handle_initialize_protocol(ctx)
    }

    pub fn initialize_payment_config(
        ctx: Context<InitializePaymentConfig>,
        args: InitializePaymentConfigArgs,
    ) -> Result<()> {
        instructions::initialize_payment_config::handle_initialize_payment_config(ctx, args)
    }

    pub fn update_payment_config(
        ctx: Context<UpdatePaymentConfig>,
        args: UpdatePaymentConfigArgs,
    ) -> Result<()> {
        instructions::update_payment_config::handle_update_payment_config(ctx, args)
    }

    pub fn rotate_payment_authority(
        ctx: Context<RotatePaymentAuthority>,
        args: RotatePaymentAuthorityArgs,
    ) -> Result<()> {
        instructions::rotate_payment_authority::handle_rotate_payment_authority(ctx, args)
    }

    pub fn create_identity(ctx: Context<CreateIdentity>, args: CreateIdentityArgs) -> Result<()> {
        instructions::create_identity::handle_create_identity(ctx, args)
    }

    pub fn deactivate_identity(
        ctx: Context<DeactivateIdentity>,
        args: DeactivateIdentityArgs,
    ) -> Result<()> {
        instructions::deactivate_identity::handle_deactivate_identity(ctx, args)
    }

    pub fn claim_handle(ctx: Context<ClaimHandle>, args: ClaimHandleArgs) -> Result<()> {
        instructions::handle::handle_claim_handle(ctx, args)
    }

    pub fn release_handle(ctx: Context<ReleaseHandle>, args: ReleaseHandleArgs) -> Result<()> {
        instructions::handle::handle_release_handle(ctx, args)
    }

    pub fn update_profile(ctx: Context<UpdateProfile>, args: UpdateProfileArgs) -> Result<()> {
        instructions::update_profile::handle_update_profile(ctx, args)
    }

    pub fn publish_post(ctx: Context<PublishPost>, args: PublishPostArgs) -> Result<()> {
        instructions::publish_post::handle_publish_post(ctx, args)
    }

    pub fn publish_post_delegated(
        ctx: Context<PublishPostDelegated>,
        args: PublishPostArgs,
    ) -> Result<()> {
        instructions::publish_post_delegated::handle_publish_post_delegated(ctx, args)
    }

    pub fn follow(ctx: Context<Follow>, args: FollowArgs) -> Result<()> {
        instructions::follow::handle_follow(ctx, args)
    }

    pub fn follow_delegated(ctx: Context<FollowDelegated>, args: FollowArgs) -> Result<()> {
        instructions::follow_delegated::handle_follow_delegated(ctx, args)
    }

    pub fn unfollow(ctx: Context<Unfollow>, args: UnfollowArgs) -> Result<()> {
        instructions::unfollow::handle_unfollow(ctx, args)
    }

    pub fn unfollow_delegated(ctx: Context<UnfollowDelegated>, args: UnfollowArgs) -> Result<()> {
        instructions::unfollow_delegated::handle_unfollow_delegated(ctx, args)
    }

    pub fn tombstone_post(ctx: Context<TombstonePost>, args: TombstonePostArgs) -> Result<()> {
        instructions::tombstone_post::handle_tombstone_post(ctx, args)
    }

    pub fn tombstone_post_delegated(
        ctx: Context<TombstonePostDelegated>,
        args: TombstonePostArgs,
    ) -> Result<()> {
        instructions::tombstone_post_delegated::handle_tombstone_post_delegated(ctx, args)
    }

    pub fn rotate_root_authority(
        ctx: Context<RotateRootAuthority>,
        args: RotateRootAuthorityArgs,
    ) -> Result<()> {
        instructions::rotate_root_authority::handle_rotate_root_authority(ctx, args)
    }

    pub fn configure_recovery_policy(
        ctx: Context<ConfigureRecoveryPolicy>,
        args: ConfigureRecoveryPolicyArgs,
    ) -> Result<()> {
        instructions::configure_recovery_policy::handle_configure_recovery_policy(ctx, args)
    }

    pub fn disable_recovery_policy(
        ctx: Context<DisableRecoveryPolicy>,
        args: DisableRecoveryPolicyArgs,
    ) -> Result<()> {
        instructions::disable_recovery_policy::handle_disable_recovery_policy(ctx, args)
    }

    pub fn request_recovery(
        ctx: Context<RequestRecovery>,
        args: RequestRecoveryArgs,
    ) -> Result<()> {
        instructions::request_recovery::handle_request_recovery(ctx, args)
    }

    pub fn approve_recovery(ctx: Context<ApproveRecovery>) -> Result<()> {
        instructions::approve_recovery::handle_approve_recovery(ctx)
    }

    pub fn cancel_recovery(ctx: Context<CancelRecovery>, args: CancelRecoveryArgs) -> Result<()> {
        instructions::cancel_recovery::handle_cancel_recovery(ctx, args)
    }

    pub fn execute_recovery(ctx: Context<ExecuteRecovery>) -> Result<()> {
        instructions::execute_recovery::handle_execute_recovery(ctx)
    }

    pub fn create_delegation(
        ctx: Context<CreateDelegation>,
        args: CreateDelegationArgs,
    ) -> Result<()> {
        instructions::create_delegation::handle_create_delegation(ctx, args)
    }

    pub fn revoke_delegation(
        ctx: Context<RevokeDelegation>,
        args: RevokeDelegationArgs,
    ) -> Result<()> {
        instructions::revoke_delegation::handle_revoke_delegation(ctx, args)
    }

    pub fn update_profile_delegated(
        ctx: Context<UpdateProfileDelegated>,
        args: UpdateProfileDelegatedArgs,
    ) -> Result<()> {
        instructions::update_profile_delegated::handle_update_profile_delegated(ctx, args)
    }

    pub fn set_block(ctx: Context<SetBlock>, args: SetBlockArgs) -> Result<()> {
        instructions::set_block::handle_set_block(ctx, args)
    }

    pub fn set_block_delegated(ctx: Context<SetBlockDelegated>, args: SetBlockArgs) -> Result<()> {
        instructions::set_block_delegated::handle_set_block_delegated(ctx, args)
    }

    pub fn create_community(
        ctx: Context<CreateCommunity>,
        args: CreateCommunityArgs,
    ) -> Result<()> {
        instructions::create_community::handle_create_community(ctx, args)
    }

    pub fn update_community_governance(
        ctx: Context<UpdateCommunityGovernance>,
        args: UpdateCommunityGovernanceArgs,
    ) -> Result<()> {
        instructions::update_community_governance::handle_update_community_governance(ctx, args)
    }

    pub fn join_community(ctx: Context<JoinCommunity>, args: JoinCommunityArgs) -> Result<()> {
        instructions::join_community::handle_join_community(ctx, args)
    }

    pub fn leave_community(ctx: Context<LeaveCommunity>, args: LeaveCommunityArgs) -> Result<()> {
        instructions::leave_community::handle_leave_community(ctx, args)
    }

    pub fn moderate_community_membership(
        ctx: Context<ModerateCommunityMembership>,
        args: ModerateCommunityMembershipArgs,
    ) -> Result<()> {
        instructions::moderate_community_membership::handle_moderate_community_membership(ctx, args)
    }

    pub fn set_reaction(ctx: Context<SetReaction>, args: SetReactionArgs) -> Result<()> {
        instructions::set_reaction::handle_set_reaction(ctx, args)
    }

    pub fn set_reaction_delegated(
        ctx: Context<SetReactionDelegated>,
        args: SetReactionArgs,
    ) -> Result<()> {
        instructions::set_reaction_delegated::handle_set_reaction_delegated(ctx, args)
    }

    pub fn create_proposal(ctx: Context<CreateProposal>, args: CreateProposalArgs) -> Result<()> {
        instructions::create_proposal::handle_create_proposal(ctx, args)
    }

    pub fn cast_vote(ctx: Context<CastVote>, args: CastVoteArgs) -> Result<()> {
        instructions::cast_vote::handle_cast_vote(ctx, args)
    }

    pub fn finalize_proposal(
        ctx: Context<FinalizeProposal>,
        args: FinalizeProposalArgs,
    ) -> Result<()> {
        instructions::finalize_proposal::handle_finalize_proposal(ctx, args)
    }

    pub fn create_subscription_offering(
        ctx: Context<CreateSubscriptionOffering>,
        args: CreateSubscriptionOfferingArgs,
    ) -> Result<()> {
        instructions::create_subscription_offering::handle_create_subscription_offering(ctx, args)
    }

    pub fn retire_subscription_offering(
        ctx: Context<RetireSubscriptionOffering>,
        args: RetireSubscriptionOfferingArgs,
    ) -> Result<()> {
        instructions::retire_subscription_offering::handle_retire_subscription_offering(ctx, args)
    }

    pub fn send_woke_tip(ctx: Context<SendWokeTip>, args: SendWokeTipArgs) -> Result<()> {
        instructions::send_woke_tip::handle_send_woke_tip(ctx, args)
    }

    pub fn settle_subscription(
        ctx: Context<SettleSubscription>,
        args: SettleSubscriptionArgs,
    ) -> Result<()> {
        instructions::settle_subscription::handle_settle_subscription(ctx, args)
    }
}

#[cfg(test)]
mod unit_tests;
