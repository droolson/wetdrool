use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, BLOCK_SEED, COMMUNITY_ROLE_ADMIN, COMMUNITY_ROLE_MEMBER, COMMUNITY_SEED,
        CONFIG_SEED, CURRENT_PROFILE_SCHEMA_VERSION, DELEGATION_SEED, FOLLOW_SEED,
        GOVERNANCE_APPROVAL_BPS, GOVERNANCE_QUORUM_BPS, HANDLE_SEED, IDENTITY_SEED,
        MAX_GOVERNANCE_START_DELAY_SLOTS, MAX_GOVERNANCE_VOTING_SLOTS, MAX_HANDLE_BYTES,
        MAX_MANIFEST_URI_BYTES, MAX_ONCHAIN_PAYMENT_SPLITS, MAX_PROTOCOL_FEE_BPS,
        MAX_RECOVERY_DELAY_SLOTS, MAX_RECOVERY_GUARDIANS, MAX_SUBSCRIPTION_PREPAY_WEEKS,
        MEMBERSHIP_SEED, MIN_GOVERNANCE_VOTING_SLOTS, MIN_RECOVERY_DELAY_SLOTS,
        ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH, PAYMENT_CONFIG_SEED, PAYMENT_RECEIPT_SEED,
        PDA_PREFIX, PDA_VERSION, POST_SEED, PROPOSAL_SEED, REACTION_LIKE, REACTION_SEED,
        RECOVERY_POLICY_SEED, RECOVERY_REQUEST_SEED, SCOPE_COMMUNITY, SCOPE_POST, SCOPE_PROFILE,
        SCOPE_SOCIAL, SUBSCRIPTION_ENTITLEMENT_SEED, SUBSCRIPTION_OFFERING_SEED, TOMBSTONE_SEED,
        VOTE_SEED, WEEK_SECONDS,
    },
    errors::SocialProtocolError,
    state::{
        BlockEdge, Community, CommunityMembership, CreatorSubscriptionOffering, Delegation,
        FollowEdge, GovernanceProposal, GovernanceProposalOutcome, GovernanceVote,
        GovernanceVoteChoice, GovernanceVotingModel, HandleClaim, Identity, PaymentConfig,
        PaymentKind, PaymentReceipt, PaymentSplit, PostReference, ProtocolConfig,
        ReactionReference, RecoveryPolicy, RecoveryRequest, RecoveryRequestState,
        SubscriptionEntitlement, SubscriptionInterval, Tombstone, TombstoneReason,
    },
    validation::{
        authorize_identity_action, authorize_identity_action_any_scope, calculate_governance_tally,
        calculate_legacy_lamport_payment_allocation, calculate_subscription_window,
        checked_decrement, checked_increment, checked_next_sequence,
        checked_recovery_execute_after, handle_hash, record_recovery_approval,
        recovery_guardian_index, validate_community_roles, validate_delegation_scopes,
        validate_governance_commitment, validate_handle, validate_handle_hash,
        validate_legacy_lamport_payment_execution, validate_legacy_lamport_payment_policy,
        validate_manifest, validate_manifest_uri, validate_membership_snapshot,
        validate_payment_aliases, validate_payment_config_snapshot, validate_payment_nonce,
        validate_payment_split_shape, validate_profile_schema_version, validate_proposal_window,
        validate_protocol_fee, validate_reaction_kind, validate_recovery_approval_invariant,
        validate_recovery_policy, validate_recovery_request_current, validate_recovery_target,
        validate_subscription_splits,
    },
};

const TEST_MANIFEST_CID: &str = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

fn serialized_len<T: AnchorSerialize>(value: &T) -> usize {
    value.try_to_vec().expect("test value must serialize").len()
}

fn max_length_uri() -> String {
    let prefix = "https://example.test/";
    let cid = TEST_MANIFEST_CID;
    let directory = "a".repeat(MAX_MANIFEST_URI_BYTES - prefix.len() - cid.len() - 1);
    format!("{prefix}{directory}/{cid}")
}

fn assert_discriminator<T: anchor_lang::Discriminator>(expected: [u8; 8]) {
    assert_eq!(T::DISCRIMINATOR, expected.as_slice());
}

fn payment_splits(basis_points: &[u16]) -> Vec<PaymentSplit> {
    let mut splits = basis_points
        .iter()
        .map(|basis_points| PaymentSplit {
            recipient_identity: Pubkey::new_unique(),
            destination: Pubkey::new_unique(),
            basis_points: *basis_points,
        })
        .collect::<Vec<_>>();
    splits.sort_by_key(|split| split.recipient_identity.to_bytes());
    splits
}

#[test]
fn account_space_constants_fit_maximum_serialized_values_exactly() {
    let key = Pubkey::new_unique();
    let max_uri = max_length_uri();

    let config = ProtocolConfig {
        version: 1,
        initialized_at_slot: u64::MAX,
        identity_count: u64::MAX,
        post_count: u64::MAX,
        follow_edge_count: u64::MAX,
        tombstone_count: u64::MAX,
        delegation_count: u64::MAX,
        block_edge_count: u64::MAX,
        community_count: u64::MAX,
        membership_count: u64::MAX,
        reaction_reference_count: u64::MAX,
        bump: u8::MAX,
    };
    let identity = Identity {
        version: 1,
        config: key,
        identity_nonce: [u8::MAX; 16],
        origin_authority: key,
        root_authority: key,
        root_rotation_count: u64::MAX,
        delegation_sequence: u64::MAX,
        sequence: u64::MAX,
        profile_sequence: u64::MAX,
        profile_manifest_hash: [u8::MAX; 32],
        profile_manifest_uri: max_uri.clone(),
        created_at_slot: u64::MAX,
        profile_updated_at_slot: u64::MAX,
        active: true,
        bump: u8::MAX,
    };
    let handle_claim = HandleClaim {
        version: 1,
        config: key,
        identity: key,
        handle_hash: [u8::MAX; 32],
        handle: "a".repeat(MAX_HANDLE_BYTES),
        identity_sequence: u64::MAX,
        claimed_at_slot: u64::MAX,
        bump: u8::MAX,
    };
    let post = PostReference {
        version: 1,
        config: key,
        author_identity: key,
        post_nonce: [u8::MAX; 16],
        manifest_hash: [u8::MAX; 32],
        manifest_uri: max_uri.clone(),
        author_sequence: u64::MAX,
        created_at_slot: u64::MAX,
        tombstoned_at_slot: Some(u64::MAX),
        bump: u8::MAX,
    };
    let follow = FollowEdge {
        version: 1,
        config: key,
        follower_identity: key,
        subject_identity: Pubkey::new_unique(),
        state_sequence: u64::MAX,
        follower_sequence: u64::MAX,
        created_at_slot: u64::MAX,
        updated_at_slot: u64::MAX,
        active: true,
        bump: u8::MAX,
    };
    let tombstone = Tombstone {
        version: 1,
        config: key,
        author_identity: key,
        target_post: Pubkey::new_unique(),
        target_hash: [u8::MAX; 32],
        author_sequence: u64::MAX,
        created_at_slot: u64::MAX,
        reason: TombstoneReason::Other,
        bump: u8::MAX,
    };
    let delegation = Delegation {
        version: 1,
        config: key,
        identity: key,
        delegate_authority: Pubkey::new_unique(),
        delegation_sequence: u64::MAX,
        scopes: u16::MAX,
        issued_by_root_authority: key,
        issued_at_root_rotation_count: u64::MAX,
        issued_at_slot: u64::MAX,
        expires_at_slot: u64::MAX,
        revoked_at_slot: Some(u64::MAX),
        state_sequence: u64::MAX,
        active: true,
        bump: u8::MAX,
    };
    let block = BlockEdge {
        version: 1,
        config: key,
        blocker_identity: key,
        subject_identity: Pubkey::new_unique(),
        state_sequence: u64::MAX,
        blocker_sequence: u64::MAX,
        created_at_slot: u64::MAX,
        updated_at_slot: u64::MAX,
        active: true,
        bump: u8::MAX,
    };
    let community = Community {
        version: 1,
        config: key,
        creator_identity: key,
        community_nonce: [u8::MAX; 16],
        manifest_hash: [u8::MAX; 32],
        manifest_uri: max_uri,
        governance_version: u16::MAX,
        governance_strategy_hash: [u8::MAX; 32],
        creator_sequence: u64::MAX,
        member_count: u64::MAX,
        created_at_slot: u64::MAX,
        updated_at_slot: u64::MAX,
        bump: u8::MAX,
    };
    let membership = CommunityMembership {
        version: 1,
        config: key,
        community: key,
        member_identity: Pubkey::new_unique(),
        assigned_by_identity: key,
        roles: u16::MAX,
        state_sequence: u64::MAX,
        authority_sequence: u64::MAX,
        created_at_slot: u64::MAX,
        updated_at_slot: u64::MAX,
        active: true,
        bump: u8::MAX,
    };
    let proposal = GovernanceProposal {
        version: 1,
        config: key,
        community: key,
        proposer_identity: key,
        manifest_hash: [u8::MAX; 32],
        manifest_uri: max_length_uri(),
        governance_version: u16::MAX,
        governance_strategy_hash: [u8::MAX; 32],
        voting_model: GovernanceVotingModel::OneActiveMemberOneVote,
        eligible_member_count: u64::MAX,
        opens_at_slot: u64::MAX,
        closes_at_slot: u64::MAX,
        quorum_bps: u16::MAX,
        approval_bps: u16::MAX,
        yes_votes: u64::MAX,
        no_votes: u64::MAX,
        abstain_votes: u64::MAX,
        created_at_slot: u64::MAX,
        proposer_sequence: u64::MAX,
        state_sequence: u64::MAX,
        outcome: GovernanceProposalOutcome::Rejected,
        finalized_at_slot: Some(u64::MAX),
        bump: u8::MAX,
    };
    let vote = GovernanceVote {
        version: 1,
        config: key,
        community: key,
        proposal: key,
        voter_identity: key,
        membership: key,
        choice: GovernanceVoteChoice::Abstain,
        voter_sequence: u64::MAX,
        membership_state_sequence: u64::MAX,
        cast_at_slot: u64::MAX,
        bump: u8::MAX,
    };
    let reaction = ReactionReference {
        version: 1,
        config: key,
        reactor_identity: key,
        target_post: Pubkey::new_unique(),
        reaction_kind: u8::MAX,
        state_sequence: u64::MAX,
        reactor_sequence: u64::MAX,
        created_at_slot: u64::MAX,
        updated_at_slot: u64::MAX,
        active: true,
        bump: u8::MAX,
    };
    let recovery_policy = RecoveryPolicy {
        version: 1,
        config: key,
        identity: key,
        policy_sequence: u64::MAX,
        guardians: vec![key; MAX_RECOVERY_GUARDIANS],
        threshold: u8::MAX,
        delay_slots: u64::MAX,
        updated_at_slot: u64::MAX,
        active: true,
        bump: u8::MAX,
    };
    let recovery_request = RecoveryRequest {
        version: 1,
        config: key,
        identity: key,
        recovery_policy: key,
        request_nonce: [u8::MAX; 16],
        policy_sequence: u64::MAX,
        current_root_authority: key,
        identity_sequence: u64::MAX,
        root_rotation_count: u64::MAX,
        target_root_authority: key,
        requesting_guardian: key,
        threshold: u8::MAX,
        guardian_count: u8::MAX,
        approvals_mask: u8::MAX,
        approval_count: u8::MAX,
        requested_at_slot: u64::MAX,
        execute_after_slot: u64::MAX,
        state: RecoveryRequestState::Executed,
        terminal_at_slot: Some(u64::MAX),
        bump: u8::MAX,
    };
    let payment_config = PaymentConfig {
        version: 1,
        config: key,
        authority: key,
        fee_destination: key,
        fee_bps: u16::MAX,
        policy_sequence: u64::MAX,
        initialized_at_slot: u64::MAX,
        updated_at_slot: u64::MAX,
        enabled: true,
        bump: u8::MAX,
    };
    let payment_splits = (0..MAX_ONCHAIN_PAYMENT_SPLITS)
        .map(|_| PaymentSplit {
            recipient_identity: Pubkey::new_unique(),
            destination: Pubkey::new_unique(),
            basis_points: u16::MAX,
        })
        .collect::<Vec<_>>();
    let subscription_offering = CreatorSubscriptionOffering {
        version: 1,
        config: key,
        creator_identity: key,
        offering_nonce: [u8::MAX; 16],
        manifest_hash: [u8::MAX; 32],
        manifest_uri: max_length_uri(),
        price_lamports: u64::MAX,
        billing_interval: SubscriptionInterval::Week,
        recipient_splits: payment_splits,
        refund_policy_hash: [u8::MAX; 32],
        max_protocol_fee_bps: u16::MAX,
        creator_root_rotation_count: u64::MAX,
        creator_sequence: u64::MAX,
        state_sequence: u64::MAX,
        created_at_slot: u64::MAX,
        updated_at_slot: u64::MAX,
        active: true,
        retired_at_slot: Some(u64::MAX),
        creator_split_index: u8::MAX,
        bump: u8::MAX,
    };
    let payment_receipt = PaymentReceipt {
        version: 1,
        config: key,
        payment_config: key,
        terms_reference: key,
        payer_identity: key,
        payer_authority: key,
        subject_identity: key,
        primary_recipient_destination: key,
        fee_destination: key,
        receipt_nonce: [u8::MAX; 16],
        kind: PaymentKind::WeeklySubscription,
        payment_policy_sequence: u64::MAX,
        terms_state_sequence: u64::MAX,
        terms_manifest_hash: [u8::MAX; 32],
        payer_root_rotation_count: u64::MAX,
        gross_lamports: u64::MAX,
        fee_bps: u16::MAX,
        fee_lamports: u64::MAX,
        distributable_lamports: u64::MAX,
        recipient_amounts: vec![u64::MAX; MAX_ONCHAIN_PAYMENT_SPLITS],
        refund_policy_hash: [u8::MAX; 32],
        entitlement_from_timestamp: i64::MAX,
        entitlement_until_timestamp: i64::MAX,
        paid_at_timestamp: i64::MAX,
        paid_at_slot: u64::MAX,
        bump: u8::MAX,
    };
    let subscription_entitlement = SubscriptionEntitlement {
        version: 1,
        config: key,
        offering: key,
        beneficiary_identity: key,
        started_at_timestamp: i64::MAX,
        valid_until_timestamp: i64::MAX,
        settlement_count: u64::MAX,
        last_receipt: key,
        state_sequence: u64::MAX,
        last_settled_at_slot: u64::MAX,
        refund_policy_hash: [u8::MAX; 32],
        bump: u8::MAX,
    };

    assert_eq!(8 + serialized_len(&config), ProtocolConfig::SPACE);
    assert_eq!(8 + serialized_len(&identity), Identity::SPACE);
    assert_eq!(8 + serialized_len(&handle_claim), HandleClaim::SPACE);
    assert_eq!(8 + serialized_len(&post), PostReference::SPACE);
    assert_eq!(8 + serialized_len(&follow), FollowEdge::SPACE);
    assert_eq!(8 + serialized_len(&tombstone), Tombstone::SPACE);
    assert_eq!(8 + serialized_len(&delegation), Delegation::SPACE);
    assert_eq!(8 + serialized_len(&block), BlockEdge::SPACE);
    assert_eq!(8 + serialized_len(&community), Community::SPACE);
    assert_eq!(8 + serialized_len(&membership), CommunityMembership::SPACE);
    assert_eq!(8 + serialized_len(&proposal), GovernanceProposal::SPACE);
    assert_eq!(8 + serialized_len(&vote), GovernanceVote::SPACE);
    assert_eq!(8 + serialized_len(&reaction), ReactionReference::SPACE);
    assert_eq!(8 + serialized_len(&recovery_policy), RecoveryPolicy::SPACE);
    assert_eq!(
        8 + serialized_len(&recovery_request),
        RecoveryRequest::SPACE
    );
    assert_eq!(8 + serialized_len(&payment_config), PaymentConfig::SPACE);
    assert_eq!(
        8 + serialized_len(&subscription_offering),
        CreatorSubscriptionOffering::SPACE
    );
    assert_eq!(8 + serialized_len(&payment_receipt), PaymentReceipt::SPACE);
    assert_eq!(
        8 + serialized_len(&subscription_entitlement),
        SubscriptionEntitlement::SPACE
    );
}

#[test]
fn handle_validation_is_normalized_bounded_and_hash_bound() {
    for valid in [
        "abc",
        "a1b",
        "1ab",
        "wokesocial",
        "a_b_c",
        "a".repeat(MAX_HANDLE_BYTES).as_str(),
    ] {
        assert!(validate_handle(valid).is_ok(), "{valid} should be valid");
        assert!(validate_handle_hash(valid, &handle_hash(valid)).is_ok());
    }

    for invalid in [
        "",
        "ab",
        "a".repeat(MAX_HANDLE_BYTES + 1).as_str(),
        "_abc",
        "abc_",
        "ab__cd",
        "Abc",
        "a-b",
        "a b",
        "éclair",
    ] {
        assert!(
            validate_handle(invalid).is_err(),
            "{invalid} should be invalid"
        );
    }

    assert_eq!(
        validate_handle("ab").expect_err("short handle must fail"),
        error!(SocialProtocolError::InvalidHandleLength)
    );
    assert_eq!(
        validate_handle("Abc").expect_err("uppercase handle must fail"),
        error!(SocialProtocolError::InvalidHandleCharacter)
    );
    assert_eq!(
        validate_handle("ab__cd").expect_err("repeated underscore must fail"),
        error!(SocialProtocolError::InvalidHandleFormat)
    );
    assert_eq!(
        validate_handle_hash("valid_handle", &[7; 32])
            .expect_err("mismatched handle digest must fail"),
        error!(SocialProtocolError::HandleHashMismatch)
    );
}

#[test]
fn manifest_validation_enforces_hash_scheme_and_byte_bounds() {
    let valid_hash = [7_u8; 32];
    let cid = TEST_MANIFEST_CID;
    let transaction_id = "A".repeat(43);
    for valid_uri in [
        format!("ipfs://{cid}"),
        format!("local://{cid}"),
        format!("ar://{transaction_id}/{cid}"),
        format!("https://example.test/{cid}"),
        format!("https://cdn.example.test:443/manifests/{cid}"),
    ] {
        assert!(
            validate_manifest(&valid_hash, &valid_uri).is_ok(),
            "{valid_uri} should be valid"
        );
    }

    assert!(validate_manifest(&[0_u8; 32], &format!("ipfs://{cid}")).is_err());
    for invalid_uri in [
        "".to_owned(),
        "ftp://example.test/object".to_owned(),
        "ipfs://opaque".to_owned(),
        format!("ipfs://{cid}/extra"),
        format!("local://{cid}?download=1"),
        format!("ar://{transaction_id}"),
        format!("ar://short/{cid}"),
        format!("ar://{transaction_id}/{cid}/extra"),
        format!("https:///{cid}"),
        format!("https://user@example.test/{cid}"),
        format!("https://example.test/{cid}?download=1"),
        format!("https://example.test/{cid}#fragment"),
        format!("https://example.test//{cid}"),
        "https://example.test/bad path".to_owned(),
        "https://example.test/<script>".to_owned(),
        "ipfs://baaaaaaaaaaaaaaaaaaaa".to_owned(),
        format!("ipfs://bafkrez{}", "a".repeat(52)),
        format!("ipfs://bafkreiz{}", "a".repeat(51)),
        format!("local://{}", cid.to_ascii_uppercase()),
        format!("local://{}z{}", &cid[..6], &cid[7..]),
        "local://bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"
            .to_owned(),
        "local://bafkrgqgpqpqtk7xpxc67cvbikdlg3aah2yqoibilk4k5za7uveq5g3hjzzd5buj4lwc7fmh7qmmnfb365qxwhojrxvduc6ubuu4de6xze7nd4"
            .to_owned(),
        format!("local://{}", &cid[..cid.len() - 1]),
        format!("local://{}b", &cid[..cid.len() - 1]),
    ] {
        assert!(
            validate_manifest_uri(&invalid_uri).is_err(),
            "{invalid_uri} should be invalid"
        );
    }
    assert!(validate_manifest_uri(&max_length_uri()).is_ok());
    assert!(validate_manifest_uri(&format!("{}a", max_length_uri())).is_err());
}

#[test]
fn profile_schema_validation_accepts_only_the_current_protected_schema() {
    assert!(validate_profile_schema_version(CURRENT_PROFILE_SCHEMA_VERSION).is_ok());
    for unsupported in [0, 1, CURRENT_PROFILE_SCHEMA_VERSION + 1, u16::MAX] {
        assert_eq!(
            validate_profile_schema_version(unsupported)
                .expect_err("non-current profile schema must fail"),
            error!(SocialProtocolError::UnsupportedProfileSchemaVersion)
        );
    }
}

#[test]
fn profile_update_instruction_and_event_abis_carry_the_schema_version() {
    let manifest_uri = format!("local://{TEST_MANIFEST_CID}");
    let manifest_hash = [7_u8; 32];
    let root_args = crate::instructions::UpdateProfileArgs {
        expected_sequence: 41,
        profile_schema_version: CURRENT_PROFILE_SCHEMA_VERSION,
        manifest_hash,
        manifest_uri: manifest_uri.clone(),
    };
    let delegated_args = crate::instructions::UpdateProfileDelegatedArgs {
        expected_sequence: 41,
        profile_schema_version: CURRENT_PROFILE_SCHEMA_VERSION,
        manifest_hash,
        manifest_uri: manifest_uri.clone(),
    };
    let root_bytes = root_args.try_to_vec().expect("root args serialize");
    let delegated_bytes = delegated_args
        .try_to_vec()
        .expect("delegated args serialize");
    assert_eq!(root_bytes, delegated_bytes);
    assert_eq!(
        &root_bytes[8..10],
        &CURRENT_PROFILE_SCHEMA_VERSION.to_le_bytes()
    );

    let key = Pubkey::new_unique();
    let event = crate::events::ProfileReferenceUpdated {
        event_version: crate::constants::PROTOCOL_VERSION,
        config: key,
        identity: key,
        authority: key,
        sequence: 42,
        previous_manifest_hash: [6; 32],
        manifest_hash,
        manifest_uri,
        updated_at_slot: 43,
        profile_schema_version: CURRENT_PROFILE_SCHEMA_VERSION,
    };
    let event_bytes = event.try_to_vec().expect("profile event serializes");
    assert_eq!(
        &event_bytes[event_bytes.len() - 2..],
        &CURRENT_PROFILE_SCHEMA_VERSION.to_le_bytes()
    );
}

#[test]
fn sequence_helpers_reject_stale_values_and_overflow() {
    assert_eq!(checked_next_sequence(9, 9).expect("matching sequence"), 10);
    assert!(checked_next_sequence(9, 8).is_err());
    assert!(checked_next_sequence(u64::MAX, u64::MAX).is_err());
    assert_eq!(checked_increment(0).expect("zero increments"), 1);
    assert!(checked_increment(u64::MAX).is_err());
    assert_eq!(checked_decrement(1).expect("one decrements"), 0);
    assert!(checked_decrement(0).is_err());
}

#[test]
fn scope_role_and_reaction_validation_is_closed_and_explicit() {
    assert!(validate_delegation_scopes(SCOPE_PROFILE).is_ok());
    assert!(validate_delegation_scopes(SCOPE_PROFILE | SCOPE_POST).is_ok());
    assert!(validate_delegation_scopes(0).is_err());
    assert!(validate_delegation_scopes(1 << 15).is_err());

    assert!(validate_community_roles(true, COMMUNITY_ROLE_MEMBER).is_ok());
    assert!(validate_community_roles(true, COMMUNITY_ROLE_MEMBER | COMMUNITY_ROLE_ADMIN).is_ok());
    assert!(validate_community_roles(true, COMMUNITY_ROLE_ADMIN).is_err());
    assert!(validate_community_roles(false, 0).is_ok());
    assert!(validate_community_roles(false, COMMUNITY_ROLE_MEMBER).is_err());

    assert!(validate_reaction_kind(REACTION_LIKE).is_ok());
    assert!(validate_reaction_kind(0).is_err());
    assert!(validate_reaction_kind(u8::MAX).is_err());
}

#[test]
fn delegated_authorization_rejects_scope_expiry_revocation_and_substitution() {
    let config = Pubkey::new_unique();
    let identity_key = Pubkey::new_unique();
    let root = Pubkey::new_unique();
    let delegate = Pubkey::new_unique();
    let mut identity = Identity {
        version: 1,
        config,
        identity_nonce: [1; 16],
        origin_authority: root,
        root_authority: root,
        root_rotation_count: 0,
        delegation_sequence: 1,
        sequence: 0,
        profile_sequence: 0,
        profile_manifest_hash: [0; 32],
        profile_manifest_uri: String::new(),
        created_at_slot: 1,
        profile_updated_at_slot: 0,
        active: true,
        bump: 1,
    };
    let mut delegation = Delegation {
        version: 1,
        config,
        identity: identity_key,
        delegate_authority: delegate,
        delegation_sequence: 1,
        scopes: SCOPE_PROFILE,
        issued_by_root_authority: root,
        issued_at_root_rotation_count: 0,
        issued_at_slot: 10,
        expires_at_slot: 20,
        revoked_at_slot: None,
        state_sequence: 1,
        active: true,
        bump: 1,
    };

    identity.version = ACCOUNT_VERSION + 1;
    assert_eq!(
        authorize_identity_action(identity_key, &identity, root, None, SCOPE_POST, 100)
            .expect_err("an unsupported identity account version must fail"),
        error!(SocialProtocolError::UnsupportedProtocolVersion)
    );
    identity.version = ACCOUNT_VERSION;
    identity.active = false;
    assert_eq!(
        authorize_identity_action(identity_key, &identity, root, None, SCOPE_POST, 100)
            .expect_err("an inactive identity must fail"),
        error!(SocialProtocolError::IdentityInactive)
    );
    identity.active = true;
    assert!(
        authorize_identity_action(identity_key, &identity, root, None, SCOPE_POST, 100).is_ok()
    );
    assert!(authorize_identity_action(
        identity_key,
        &identity,
        delegate,
        Some(&delegation),
        SCOPE_PROFILE,
        20,
    )
    .is_ok());
    identity.root_authority = Pubkey::new_unique();
    identity.root_rotation_count = 1;
    assert_eq!(
        authorize_identity_action(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_PROFILE,
            20,
        )
        .expect_err("a displaced issuer must fail"),
        error!(SocialProtocolError::DelegationIssuerSuperseded)
    );
    identity.root_authority = root;
    identity.root_rotation_count = 2;
    assert_eq!(
        authorize_identity_action(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_PROFILE,
            20,
        )
        .expect_err("an old root epoch must fail"),
        error!(SocialProtocolError::DelegationIssuerSuperseded)
    );
    identity.root_rotation_count = 0;
    assert_eq!(
        authorize_identity_action(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_POST,
            20,
        )
        .expect_err("a missing scope must fail"),
        error!(SocialProtocolError::DelegationScopeMissing)
    );
    assert_eq!(
        authorize_identity_action(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_PROFILE,
            21,
        )
        .expect_err("an expired delegation must fail"),
        error!(SocialProtocolError::DelegationExpired)
    );
    delegation.active = false;
    delegation.revoked_at_slot = Some(20);
    assert_eq!(
        authorize_identity_action(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_PROFILE,
            20,
        )
        .expect_err("a revoked delegation must fail"),
        error!(SocialProtocolError::DelegationRevoked)
    );
    delegation.active = true;
    delegation.revoked_at_slot = None;
    delegation.identity = Pubkey::new_unique();
    assert_eq!(
        authorize_identity_action(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_PROFILE,
            20,
        )
        .expect_err("a substituted identity must fail"),
        error!(SocialProtocolError::DelegationSubstitution)
    );
}

#[test]
fn governance_delegation_accepts_either_social_or_community_scope() {
    let config = Pubkey::new_unique();
    let identity_key = Pubkey::new_unique();
    let root = Pubkey::new_unique();
    let delegate = Pubkey::new_unique();
    let mut identity = Identity {
        version: 1,
        config,
        identity_nonce: [1; 16],
        origin_authority: root,
        root_authority: root,
        root_rotation_count: 2,
        delegation_sequence: 1,
        sequence: 0,
        profile_sequence: 0,
        profile_manifest_hash: [0; 32],
        profile_manifest_uri: String::new(),
        created_at_slot: 1,
        profile_updated_at_slot: 0,
        active: true,
        bump: 1,
    };
    let mut delegation = Delegation {
        version: 1,
        config,
        identity: identity_key,
        delegate_authority: delegate,
        delegation_sequence: 1,
        scopes: SCOPE_SOCIAL,
        issued_by_root_authority: root,
        issued_at_root_rotation_count: 2,
        issued_at_slot: 10,
        expires_at_slot: 20,
        revoked_at_slot: None,
        state_sequence: 1,
        active: true,
        bump: 1,
    };

    identity.version = ACCOUNT_VERSION + 1;
    assert_eq!(
        authorize_identity_action_any_scope(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_SOCIAL | SCOPE_COMMUNITY,
            20,
        )
        .expect_err("an unsupported identity account version must fail"),
        error!(SocialProtocolError::UnsupportedProtocolVersion)
    );
    identity.version = ACCOUNT_VERSION;
    assert!(authorize_identity_action_any_scope(
        identity_key,
        &identity,
        delegate,
        Some(&delegation),
        SCOPE_SOCIAL | SCOPE_COMMUNITY,
        20,
    )
    .is_ok());
    delegation.scopes = SCOPE_COMMUNITY;
    assert!(authorize_identity_action_any_scope(
        identity_key,
        &identity,
        delegate,
        Some(&delegation),
        SCOPE_SOCIAL | SCOPE_COMMUNITY,
        20,
    )
    .is_ok());
    delegation.scopes = SCOPE_PROFILE;
    assert_eq!(
        authorize_identity_action_any_scope(
            identity_key,
            &identity,
            delegate,
            Some(&delegation),
            SCOPE_SOCIAL | SCOPE_COMMUNITY,
            20,
        )
        .expect_err("an unrelated scope must fail"),
        error!(SocialProtocolError::DelegationScopeMissing)
    );
}

#[test]
fn governance_strategy_and_windows_are_canonical_and_bounded() {
    const STRATEGY: &str = concat!(
        "wokenet:community-governance-strategy:v1",
        "\0",
        "{\"abstainTreatment\":\"quorum-only\",\"approvalBasisPoints\":5001,",
        "\"execution\":\"outcome-record-only\",\"model\":\"one-active-member-one-vote\",",
        "\"quorumBasisPoints\":5000,\"version\":1}"
    );
    assert_eq!(
        solana_sha256_hasher::hash(STRATEGY.as_bytes()).to_bytes(),
        ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH
    );
    assert!(validate_governance_commitment(
        &ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH,
        GOVERNANCE_QUORUM_BPS,
        GOVERNANCE_APPROVAL_BPS,
    )
    .is_ok());
    assert_eq!(
        validate_governance_commitment(&[7; 32], GOVERNANCE_QUORUM_BPS, GOVERNANCE_APPROVAL_BPS,)
            .expect_err("an uncommitted strategy must fail"),
        error!(SocialProtocolError::UnsupportedGovernanceStrategy)
    );
    assert_eq!(
        validate_governance_commitment(
            &ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH,
            GOVERNANCE_QUORUM_BPS - 1,
            GOVERNANCE_APPROVAL_BPS,
        )
        .expect_err("custom thresholds must fail"),
        error!(SocialProtocolError::GovernanceThresholdMismatch)
    );

    let now = 1_000;
    assert!(validate_proposal_window(now, now, now + MIN_GOVERNANCE_VOTING_SLOTS).is_ok());
    assert!(validate_proposal_window(
        now,
        now + MAX_GOVERNANCE_START_DELAY_SLOTS,
        now + MAX_GOVERNANCE_START_DELAY_SLOTS + MAX_GOVERNANCE_VOTING_SLOTS,
    )
    .is_ok());
    assert!(validate_proposal_window(now, now - 1, now + 5).is_err());
    assert!(validate_proposal_window(now, now, now + MIN_GOVERNANCE_VOTING_SLOTS - 1).is_err());
    assert!(validate_proposal_window(
        now,
        now + MAX_GOVERNANCE_START_DELAY_SLOTS + 1,
        now + MAX_GOVERNANCE_START_DELAY_SLOTS + 3,
    )
    .is_err());
    assert!(validate_proposal_window(now, now, now + MAX_GOVERNANCE_VOTING_SLOTS + 1).is_err());
    assert!(validate_proposal_window(u64::MAX, u64::MAX, 0).is_err());
}

#[test]
fn governance_tally_uses_u128_and_explicit_abstention_semantics() {
    let accepted =
        calculate_governance_tally(4, 2, 1, 1, GOVERNANCE_QUORUM_BPS, GOVERNANCE_APPROVAL_BPS)
            .expect("two thirds approval with full participation");
    assert_eq!(accepted.participating_votes, 4);
    assert_eq!(accepted.decisive_votes, 3);
    assert!(accepted.quorum_met);
    assert!(accepted.approval_met);

    let below_quorum =
        calculate_governance_tally(10, 4, 0, 0, GOVERNANCE_QUORUM_BPS, GOVERNANCE_APPROVAL_BPS)
            .expect("a bounded tally");
    assert!(!below_quorum.quorum_met);
    assert!(below_quorum.approval_met);

    let abstention_only =
        calculate_governance_tally(2, 0, 0, 2, GOVERNANCE_QUORUM_BPS, GOVERNANCE_APPROVAL_BPS)
            .expect("abstentions count for quorum");
    assert!(abstention_only.quorum_met);
    assert!(!abstention_only.approval_met);

    let exact_half =
        calculate_governance_tally(2, 1, 1, 0, GOVERNANCE_QUORUM_BPS, GOVERNANCE_APPROVAL_BPS)
            .expect("an exact split");
    assert!(exact_half.quorum_met);
    assert!(!exact_half.approval_met);

    assert!(
        calculate_governance_tally(0, 0, 0, 0, GOVERNANCE_QUORUM_BPS, GOVERNANCE_APPROVAL_BPS)
            .is_err()
    );
    assert!(
        calculate_governance_tally(1, 2, 0, 0, GOVERNANCE_QUORUM_BPS, GOVERNANCE_APPROVAL_BPS)
            .is_err()
    );
    assert!(calculate_governance_tally(
        u64::MAX,
        u64::MAX,
        1,
        0,
        GOVERNANCE_QUORUM_BPS,
        GOVERNANCE_APPROVAL_BPS
    )
    .is_err());
}

#[test]
fn governance_membership_snapshot_orders_same_slot_changes_by_sequence() {
    assert!(validate_membership_snapshot(100, 7, 100, 8).is_ok());
    assert_eq!(
        validate_membership_snapshot(100, 8, 100, 8)
            .expect_err("a same-slot membership change after proposal creation must fail"),
        error!(SocialProtocolError::MemberNotEligibleAtSnapshot)
    );
    assert!(validate_membership_snapshot(101, 7, 100, 8).is_err());
    assert!(validate_membership_snapshot(99, 9, 100, 8).is_err());
}

#[test]
fn legacy_lamport_allocator_is_exact_order_independent_and_conservative() {
    let splits = payment_splits(&[5_000, 5_000]);
    let allocation = calculate_legacy_lamport_payment_allocation(101, 250, &splits)
        .expect("valid payment must allocate");
    assert_eq!(allocation.fee_lamports, 2);
    assert_eq!(allocation.distributable_lamports, 99);
    assert_eq!(allocation.recipient_amounts, vec![50, 49]);
    assert_eq!(
        allocation.fee_lamports + allocation.recipient_amounts.iter().sum::<u64>(),
        101
    );

    let tie = calculate_legacy_lamport_payment_allocation(3, 0, &splits)
        .expect("raw identity ordering must break equal remainders");
    assert_eq!(tie.recipient_amounts, vec![2, 1]);

    let maximum =
        calculate_legacy_lamport_payment_allocation(u64::MAX, MAX_PROTOCOL_FEE_BPS, &splits)
            .expect("u128 intermediates must support the full lamport transfer range");
    assert_eq!(
        u128::from(maximum.fee_lamports)
            + maximum
                .recipient_amounts
                .iter()
                .map(|amount| u128::from(*amount))
                .sum::<u128>(),
        u128::from(u64::MAX)
    );
}

#[test]
fn legacy_lamport_allocator_rejects_malformed_splits_and_rounding_underflow() {
    assert!(calculate_legacy_lamport_payment_allocation(0, 0, &payment_splits(&[10_000])).is_err());
    assert!(
        calculate_legacy_lamport_payment_allocation(1, 0, &payment_splits(&[5_000, 5_000]))
            .is_err()
    );
    assert!(calculate_legacy_lamport_payment_allocation(
        10,
        MAX_PROTOCOL_FEE_BPS + 1,
        &payment_splits(&[10_000])
    )
    .is_err());
    assert!(validate_protocol_fee(MAX_PROTOCOL_FEE_BPS).is_ok());
    assert!(validate_protocol_fee(MAX_PROTOCOL_FEE_BPS + 1).is_err());
    assert!(validate_payment_nonce(&[1; 16]).is_ok());
    assert!(validate_payment_nonce(&[0; 16]).is_err());

    let mut wrong_total = payment_splits(&[5_000, 4_999]);
    assert!(validate_payment_split_shape(&wrong_total).is_err());
    wrong_total[1].basis_points = 5_000;
    assert!(validate_payment_split_shape(&wrong_total).is_ok());

    let mut unordered = wrong_total.clone();
    unordered.reverse();
    assert!(validate_payment_split_shape(&unordered).is_err());

    let mut duplicate_destination = wrong_total.clone();
    duplicate_destination[1].destination = duplicate_destination[0].destination;
    assert!(validate_payment_split_shape(&duplicate_destination).is_err());

    let too_many = payment_splits(&[2_500; MAX_ONCHAIN_PAYMENT_SPLITS + 1]);
    assert!(validate_payment_split_shape(&too_many).is_err());
}

#[test]
fn subscription_splits_require_the_creator_and_disallow_payment_aliases() {
    let splits = payment_splits(&[2_500, 7_500]);
    let creator = splits[0];
    assert_eq!(
        validate_subscription_splits(&splits, creator.recipient_identity, creator.destination)
            .expect("creator split must be found"),
        0
    );
    assert!(
        validate_subscription_splits(&splits, Pubkey::new_unique(), Pubkey::new_unique()).is_err()
    );

    let payer_identity = Pubkey::new_unique();
    let payer_authority = Pubkey::new_unique();
    let fee_destination = Pubkey::new_unique();
    assert!(
        validate_payment_aliases(payer_identity, payer_authority, fee_destination, &splits).is_ok()
    );
    assert!(validate_payment_aliases(
        splits[0].recipient_identity,
        payer_authority,
        fee_destination,
        &splits
    )
    .is_err());
    assert!(validate_payment_aliases(
        payer_identity,
        payer_authority,
        splits[0].destination,
        &splits
    )
    .is_err());
}

#[test]
fn payment_policy_snapshots_fail_closed_on_pause_or_any_preview_drift() {
    let fee_destination = Pubkey::new_unique();
    let mut payment_config = PaymentConfig {
        version: 1,
        config: Pubkey::new_unique(),
        authority: Pubkey::new_unique(),
        fee_destination,
        fee_bps: 250,
        policy_sequence: 7,
        initialized_at_slot: 1,
        updated_at_slot: 2,
        enabled: true,
        bump: 1,
    };
    assert!(validate_payment_config_snapshot(&payment_config, 7, 250, fee_destination).is_ok());
    assert!(validate_payment_config_snapshot(&payment_config, 6, 250, fee_destination).is_err());
    assert!(validate_payment_config_snapshot(&payment_config, 7, 251, fee_destination).is_err());
    assert!(
        validate_payment_config_snapshot(&payment_config, 7, 250, Pubkey::new_unique()).is_err()
    );
    payment_config.enabled = false;
    assert!(validate_payment_config_snapshot(&payment_config, 7, 250, fee_destination).is_err());
}

#[test]
fn legacy_lamport_as_woke_payment_abi_cannot_execute_or_be_unpaused() {
    assert!(validate_legacy_lamport_payment_execution().is_err());
    assert!(validate_legacy_lamport_payment_policy(true).is_err());
    assert!(validate_legacy_lamport_payment_policy(false).is_ok());
}

#[test]
fn weekly_entitlement_windows_are_monotonic_checked_and_bounded() {
    let now = 1_000_000_i64;
    assert_eq!(
        calculate_subscription_window(now, 0).expect("first period must start now"),
        (now, now + WEEK_SECONDS)
    );
    assert_eq!(
        calculate_subscription_window(now, now + WEEK_SECONDS)
            .expect("early renewal must extend paid-through time"),
        (now + WEEK_SECONDS, now + (2 * WEEK_SECONDS))
    );
    assert!(calculate_subscription_window(
        now,
        now + ((MAX_SUBSCRIPTION_PREPAY_WEEKS - 1) * WEEK_SECONDS)
    )
    .is_ok());
    assert!(calculate_subscription_window(
        now,
        now + (MAX_SUBSCRIPTION_PREPAY_WEEKS * WEEK_SECONDS)
    )
    .is_err());
    assert!(calculate_subscription_window(-1, 0).is_err());
    assert!(calculate_subscription_window(i64::MAX, 0).is_err());
}

#[test]
fn legacy_v1_instruction_event_and_account_discriminators_are_frozen() {
    assert_discriminator::<crate::instruction::CastVote>([20, 212, 15, 189, 69, 180, 69, 151]);
    assert_discriminator::<crate::instruction::ClaimHandle>([93, 142, 47, 111, 164, 134, 99, 181]);
    assert_discriminator::<crate::instruction::CreateCommunity>([
        203, 214, 176, 194, 13, 207, 22, 60,
    ]);
    assert_discriminator::<crate::instruction::CreateDelegation>([
        177, 165, 93, 55, 227, 163, 61, 175,
    ]);
    assert_discriminator::<crate::instruction::CreateIdentity>([
        12, 253, 209, 41, 176, 51, 195, 179,
    ]);
    assert_discriminator::<crate::instruction::CreateProposal>([
        132, 116, 68, 174, 216, 160, 198, 22,
    ]);
    assert_discriminator::<crate::instruction::FinalizeProposal>([
        23, 68, 51, 167, 109, 173, 187, 164,
    ]);
    assert_discriminator::<crate::instruction::Follow>([161, 61, 150, 122, 164, 153, 0, 18]);
    assert_discriminator::<crate::instruction::FollowDelegated>([
        234, 77, 111, 22, 209, 80, 177, 108,
    ]);
    assert_discriminator::<crate::instruction::InitializeProtocol>([
        188, 233, 252, 106, 134, 146, 202, 91,
    ]);
    assert_discriminator::<crate::instruction::PublishPost>([182, 78, 189, 205, 125, 46, 217, 154]);
    assert_discriminator::<crate::instruction::PublishPostDelegated>([
        177, 131, 214, 24, 206, 88, 180, 204,
    ]);
    assert_discriminator::<crate::instruction::ReleaseHandle>([19, 58, 205, 41, 216, 105, 195, 14]);
    assert_discriminator::<crate::instruction::RevokeDelegation>([
        188, 92, 135, 67, 160, 181, 54, 62,
    ]);
    assert_discriminator::<crate::instruction::RotateRootAuthority>([
        35, 58, 115, 103, 59, 77, 214, 46,
    ]);
    assert_discriminator::<crate::instruction::SetBlock>([118, 39, 143, 189, 159, 146, 46, 160]);
    assert_discriminator::<crate::instruction::SetBlockDelegated>([
        241, 233, 188, 231, 249, 250, 252, 62,
    ]);
    assert_discriminator::<crate::instruction::SetCommunityMembership>([
        145, 88, 213, 239, 60, 124, 114, 12,
    ]);
    assert_discriminator::<crate::instruction::SetReaction>([
        189, 188, 123, 156, 127, 248, 203, 107,
    ]);
    assert_discriminator::<crate::instruction::SetReactionDelegated>([
        35, 226, 246, 214, 180, 139, 52, 215,
    ]);
    assert_discriminator::<crate::instruction::TombstonePost>([
        128, 127, 76, 148, 234, 59, 231, 133,
    ]);
    assert_discriminator::<crate::instruction::TombstonePostDelegated>([
        40, 65, 247, 48, 109, 217, 126, 19,
    ]);
    assert_discriminator::<crate::instruction::Unfollow>([122, 47, 24, 161, 12, 85, 224, 68]);
    assert_discriminator::<crate::instruction::UnfollowDelegated>([
        23, 222, 24, 149, 182, 60, 11, 153,
    ]);
    assert_discriminator::<crate::instruction::UpdateCommunityGovernance>([
        32, 181, 155, 5, 19, 70, 99, 113,
    ]);
    assert_discriminator::<crate::instruction::UpdateProfile>([98, 67, 99, 206, 86, 115, 175, 1]);
    assert_discriminator::<crate::instruction::UpdateProfileDelegated>([
        232, 197, 79, 205, 45, 167, 232, 195,
    ]);

    assert_discriminator::<crate::events::BlockStateChanged>([
        172, 189, 73, 239, 129, 119, 51, 239,
    ]);
    assert_discriminator::<crate::events::CommunityCreated>([218, 186, 205, 161, 125, 58, 101, 64]);
    assert_discriminator::<crate::events::CommunityGovernanceUpdated>([
        196, 91, 184, 153, 102, 11, 202, 176,
    ]);
    assert_discriminator::<crate::events::CommunityMembershipChanged>([
        140, 136, 245, 151, 152, 11, 75, 249,
    ]);
    assert_discriminator::<crate::events::DelegationCreated>([20, 93, 12, 34, 227, 63, 100, 136]);
    assert_discriminator::<crate::events::DelegationRevoked>([59, 158, 142, 49, 164, 116, 220, 8]);
    assert_discriminator::<crate::events::FollowStateChanged>([
        134, 25, 152, 20, 65, 243, 107, 118,
    ]);
    assert_discriminator::<crate::events::HandleClaimed>([23, 183, 225, 13, 62, 87, 199, 150]);
    assert_discriminator::<crate::events::HandleReleased>([46, 27, 52, 76, 216, 175, 174, 128]);
    assert_discriminator::<crate::events::IdentityCreated>([247, 185, 231, 174, 133, 94, 200, 142]);
    assert_discriminator::<crate::events::PostReferencePublished>([
        65, 16, 116, 252, 204, 196, 161, 100,
    ]);
    assert_discriminator::<crate::events::PostTombstoned>([228, 246, 184, 38, 105, 108, 147, 36]);
    assert_discriminator::<crate::events::ProfileReferenceUpdated>([
        251, 63, 9, 200, 203, 176, 143, 98,
    ]);
    assert_discriminator::<crate::events::ProposalCreated>([186, 8, 160, 108, 81, 13, 51, 206]);
    assert_discriminator::<crate::events::ProposalFinalized>([159, 104, 210, 220, 86, 209, 61, 51]);
    assert_discriminator::<crate::events::ProtocolInitialized>([
        173, 122, 168, 254, 9, 118, 76, 132,
    ]);
    assert_discriminator::<crate::events::ReactionStateChanged>([
        183, 83, 52, 150, 209, 41, 13, 94,
    ]);
    assert_discriminator::<crate::events::RootAuthorityRotated>([
        45, 188, 81, 157, 31, 106, 151, 77,
    ]);
    assert_discriminator::<crate::events::VoteCast>([39, 53, 195, 104, 188, 17, 225, 213]);

    assert_discriminator::<BlockEdge>([106, 121, 254, 140, 147, 66, 217, 41]);
    assert_discriminator::<Community>([192, 73, 211, 158, 178, 81, 19, 112]);
    assert_discriminator::<CommunityMembership>([132, 129, 73, 164, 49, 56, 12, 26]);
    assert_discriminator::<Delegation>([237, 90, 140, 159, 124, 255, 243, 80]);
    assert_discriminator::<FollowEdge>([108, 95, 23, 89, 190, 92, 157, 126]);
    assert_discriminator::<GovernanceProposal>([53, 107, 240, 190, 43, 73, 65, 143]);
    assert_discriminator::<GovernanceVote>([157, 104, 16, 111, 208, 31, 53, 132]);
    assert_discriminator::<HandleClaim>([148, 215, 248, 53, 11, 234, 115, 190]);
    assert_discriminator::<Identity>([58, 132, 5, 12, 176, 164, 85, 112]);
    assert_discriminator::<PostReference>([211, 85, 89, 48, 227, 1, 60, 119]);
    assert_discriminator::<ProtocolConfig>([207, 91, 250, 28, 152, 179, 215, 209]);
    assert_discriminator::<ReactionReference>([198, 105, 167, 88, 184, 113, 83, 2]);
    assert_discriminator::<Tombstone>([45, 187, 252, 155, 232, 114, 36, 22]);
}

#[test]
fn identity_deactivation_discriminators_are_frozen() {
    assert_discriminator::<crate::instruction::DeactivateIdentity>([
        58, 175, 10, 246, 145, 179, 1, 179,
    ]);
    assert_discriminator::<crate::events::IdentityDeactivated>([19, 21, 51, 7, 82, 100, 132, 255]);
}

#[test]
fn legacy_woke_named_payment_discriminators_are_frozen() {
    assert_discriminator::<crate::instruction::InitializePaymentConfig>([
        38, 187, 7, 244, 201, 111, 164, 182,
    ]);
    assert_discriminator::<crate::instruction::UpdatePaymentConfig>([
        233, 162, 182, 43, 61, 208, 188, 169,
    ]);
    assert_discriminator::<crate::instruction::RotatePaymentAuthority>([
        130, 220, 113, 212, 146, 91, 227, 218,
    ]);
    assert_discriminator::<crate::instruction::CreateSubscriptionOffering>([
        176, 121, 188, 91, 87, 92, 113, 216,
    ]);
    assert_discriminator::<crate::instruction::RetireSubscriptionOffering>([
        207, 71, 200, 23, 92, 151, 101, 99,
    ]);
    assert_discriminator::<crate::instruction::SendWokeTip>([45, 180, 20, 31, 17, 4, 214, 17]);
    assert_discriminator::<crate::instruction::SettleSubscription>([
        140, 212, 22, 211, 219, 187, 4, 131,
    ]);

    assert_discriminator::<crate::events::PaymentConfigInitialized>([
        12, 146, 193, 194, 231, 51, 227, 9,
    ]);
    assert_discriminator::<crate::events::PaymentConfigUpdated>([
        186, 235, 216, 17, 194, 224, 181, 66,
    ]);
    assert_discriminator::<crate::events::PaymentAuthorityRotated>([
        163, 98, 210, 236, 171, 187, 204, 62,
    ]);
    assert_discriminator::<crate::events::SubscriptionOfferingCreated>([
        55, 231, 216, 246, 111, 122, 144, 233,
    ]);
    assert_discriminator::<crate::events::SubscriptionOfferingRetired>([
        168, 40, 69, 55, 165, 163, 200, 123,
    ]);
    assert_discriminator::<crate::events::WokeTipSettled>([142, 81, 75, 163, 58, 30, 248, 115]);
    assert_discriminator::<crate::events::SubscriptionSettled>([
        146, 48, 250, 127, 131, 180, 247, 174,
    ]);

    assert_discriminator::<PaymentConfig>([252, 166, 185, 239, 186, 79, 212, 152]);
    assert_discriminator::<CreatorSubscriptionOffering>([50, 13, 139, 74, 175, 63, 241, 44]);
    assert_discriminator::<PaymentReceipt>([168, 198, 209, 4, 60, 235, 126, 109]);
    assert_discriminator::<SubscriptionEntitlement>([93, 180, 102, 122, 243, 136, 75, 205]);
}

#[test]
fn recovery_policy_and_delay_validation_are_bounded_and_checked() {
    let root = Pubkey::new_unique();
    let guardians = [
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
    ];

    assert!(validate_recovery_policy(root, &guardians[..2], 2, MIN_RECOVERY_DELAY_SLOTS,).is_ok());
    assert!(validate_recovery_policy(
        root,
        &guardians,
        MAX_RECOVERY_GUARDIANS as u8,
        MAX_RECOVERY_DELAY_SLOTS,
    )
    .is_ok());
    assert_eq!(
        validate_recovery_policy(root, &guardians[..1], 1, MIN_RECOVERY_DELAY_SLOTS)
            .expect_err("one guardian must fail"),
        error!(SocialProtocolError::InvalidRecoveryPolicy)
    );
    assert_eq!(
        validate_recovery_policy(root, &guardians[..2], 1, MIN_RECOVERY_DELAY_SLOTS)
            .expect_err("a one-of-two threshold must fail"),
        error!(SocialProtocolError::InvalidRecoveryThreshold)
    );
    assert_eq!(
        validate_recovery_policy(root, &guardians[..2], 3, MIN_RECOVERY_DELAY_SLOTS)
            .expect_err("threshold above guardian count must fail"),
        error!(SocialProtocolError::InvalidRecoveryThreshold)
    );
    assert_eq!(
        validate_recovery_policy(
            root,
            &[guardians[0], guardians[0]],
            2,
            MIN_RECOVERY_DELAY_SLOTS,
        )
        .expect_err("duplicate guardians must fail"),
        error!(SocialProtocolError::DuplicateRecoveryGuardian)
    );
    assert_eq!(
        validate_recovery_policy(root, &[guardians[0], root], 2, MIN_RECOVERY_DELAY_SLOTS,)
            .expect_err("the current root cannot be a guardian"),
        error!(SocialProtocolError::InvalidRecoveryGuardian)
    );
    assert_eq!(
        validate_recovery_policy(
            root,
            &[guardians[0], Pubkey::default()],
            2,
            MIN_RECOVERY_DELAY_SLOTS,
        )
        .expect_err("a zero guardian must fail"),
        error!(SocialProtocolError::InvalidRecoveryGuardian)
    );
    assert!(
        validate_recovery_policy(root, &guardians[..2], 2, MIN_RECOVERY_DELAY_SLOTS - 1,).is_err()
    );
    assert!(
        validate_recovery_policy(root, &guardians[..2], 2, MAX_RECOVERY_DELAY_SLOTS + 1,).is_err()
    );

    assert_eq!(
        checked_recovery_execute_after(10, MIN_RECOVERY_DELAY_SLOTS)
            .expect("bounded delay must add"),
        10 + MIN_RECOVERY_DELAY_SLOTS
    );
    assert_eq!(
        checked_recovery_execute_after(u64::MAX, MIN_RECOVERY_DELAY_SLOTS)
            .expect_err("slot addition overflow must fail"),
        error!(SocialProtocolError::ArithmeticOverflow)
    );
    assert!(validate_recovery_target(root, Pubkey::new_unique()).is_ok());
    assert_eq!(
        validate_recovery_target(root, root).expect_err("target cannot equal current root"),
        error!(SocialProtocolError::InvalidRecoveryTarget)
    );
    assert!(validate_recovery_target(root, Pubkey::default()).is_err());
}

#[test]
fn recovery_approvals_and_snapshots_reject_duplicates_and_stale_state() {
    let config = Pubkey::new_unique();
    let identity_key = Pubkey::new_unique();
    let policy_key = Pubkey::new_unique();
    let root = Pubkey::new_unique();
    let target = Pubkey::new_unique();
    let guardians = [
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
    ];
    let mut identity = Identity {
        version: 1,
        config,
        identity_nonce: [1; 16],
        origin_authority: Pubkey::new_unique(),
        root_authority: root,
        root_rotation_count: 7,
        delegation_sequence: 0,
        sequence: 11,
        profile_sequence: 0,
        profile_manifest_hash: [0; 32],
        profile_manifest_uri: String::new(),
        created_at_slot: 1,
        profile_updated_at_slot: 0,
        active: true,
        bump: 1,
    };
    let mut policy = RecoveryPolicy {
        version: 1,
        config,
        identity: identity_key,
        policy_sequence: 3,
        guardians: guardians.to_vec(),
        threshold: 2,
        delay_slots: MIN_RECOVERY_DELAY_SLOTS,
        updated_at_slot: 20,
        active: true,
        bump: 2,
    };
    let mut request = RecoveryRequest {
        version: 1,
        config,
        identity: identity_key,
        recovery_policy: policy_key,
        request_nonce: [9; 16],
        policy_sequence: 3,
        current_root_authority: root,
        identity_sequence: 11,
        root_rotation_count: 7,
        target_root_authority: target,
        requesting_guardian: guardians[0],
        threshold: 2,
        guardian_count: 3,
        approvals_mask: 0,
        approval_count: 0,
        requested_at_slot: 100,
        execute_after_slot: 100 + MIN_RECOVERY_DELAY_SLOTS,
        state: RecoveryRequestState::Pending,
        terminal_at_slot: None,
        bump: 3,
    };

    assert_eq!(
        recovery_guardian_index(&policy, guardians[1]).expect("known guardian"),
        1
    );
    assert_eq!(
        recovery_guardian_index(&policy, Pubkey::new_unique())
            .expect_err("unknown guardian must fail"),
        error!(SocialProtocolError::RecoveryGuardianNotAuthorized)
    );
    assert_eq!(
        record_recovery_approval(&mut request, 0).expect("first approval"),
        1
    );
    assert_eq!(request.approvals_mask, 0b001);
    assert_eq!(
        record_recovery_approval(&mut request, 0).expect_err("duplicate approval must fail"),
        error!(SocialProtocolError::RecoveryGuardianAlreadyApproved)
    );
    assert_eq!(
        record_recovery_approval(&mut request, 2).expect("distinct approval"),
        2
    );
    assert_eq!(request.approvals_mask, 0b101);
    assert!(validate_recovery_request_current(&identity, &policy, &request).is_ok());

    request.approval_count = 1;
    assert_eq!(
        validate_recovery_approval_invariant(&request)
            .expect_err("bitmap/count disagreement must fail"),
        error!(SocialProtocolError::RecoveryApprovalInvariant)
    );
    request.approval_count = 2;

    policy.policy_sequence = 4;
    assert_eq!(
        validate_recovery_request_current(&identity, &policy, &request)
            .expect_err("policy sequence changes must stale requests"),
        error!(SocialProtocolError::RecoveryRequestStalePolicy)
    );
    policy.policy_sequence = 3;
    identity.root_authority = Pubkey::new_unique();
    assert_eq!(
        validate_recovery_request_current(&identity, &policy, &request)
            .expect_err("root changes must stale requests"),
        error!(SocialProtocolError::RecoveryRequestStaleRoot)
    );
    identity.root_authority = root;
    identity.sequence = 12;
    assert_eq!(
        validate_recovery_request_current(&identity, &policy, &request)
            .expect_err("identity sequence changes must stale requests"),
        error!(SocialProtocolError::RecoveryRequestStaleIdentitySequence)
    );
    identity.sequence = 11;
    identity.root_rotation_count = 8;
    assert_eq!(
        validate_recovery_request_current(&identity, &policy, &request)
            .expect_err("root epoch changes must stale requests"),
        error!(SocialProtocolError::RecoveryRequestStaleEpoch)
    );
    identity.root_rotation_count = 7;
    request.state = RecoveryRequestState::Cancelled;
    request.terminal_at_slot = Some(200);
    assert_eq!(
        validate_recovery_request_current(&identity, &policy, &request)
            .expect_err("terminal requests must not replay"),
        error!(SocialProtocolError::RecoveryRequestAlreadyTerminal)
    );
}

#[test]
fn pda_domains_are_deterministic_and_non_overlapping() {
    let identity_nonce = [1_u8; 16];
    let other_nonce = [2_u8; 16];
    let follower = Pubkey::new_unique();
    let subject = Pubkey::new_unique();
    let other_authority = Pubkey::new_unique();

    let (config, _) =
        Pubkey::find_program_address(&[PDA_PREFIX, PDA_VERSION, CONFIG_SEED], &crate::ID);
    let (identity, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            follower.as_ref(),
            identity_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (same_identity, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            follower.as_ref(),
            identity_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (other_identity, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            follower.as_ref(),
            other_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (other_authority_identity, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            IDENTITY_SEED,
            other_authority.as_ref(),
            identity_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (post, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            POST_SEED,
            follower.as_ref(),
            identity_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (follow, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            FOLLOW_SEED,
            follower.as_ref(),
            subject.as_ref(),
        ],
        &crate::ID,
    );
    let (tombstone, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            TOMBSTONE_SEED,
            follower.as_ref(),
            post.as_ref(),
        ],
        &crate::ID,
    );
    let delegation_sequence = 1_u64.to_le_bytes();
    let reaction_kind = REACTION_LIKE.to_le_bytes();
    let normalized_handle = "alice_1";
    let normalized_handle_hash = handle_hash(normalized_handle);
    let (delegation, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            DELEGATION_SEED,
            identity.as_ref(),
            other_authority.as_ref(),
            delegation_sequence.as_ref(),
        ],
        &crate::ID,
    );
    let (block, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            BLOCK_SEED,
            identity.as_ref(),
            subject.as_ref(),
        ],
        &crate::ID,
    );
    let (community, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            COMMUNITY_SEED,
            identity.as_ref(),
            other_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (membership, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            MEMBERSHIP_SEED,
            community.as_ref(),
            subject.as_ref(),
        ],
        &crate::ID,
    );
    let (reaction, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            REACTION_SEED,
            identity.as_ref(),
            post.as_ref(),
            reaction_kind.as_ref(),
        ],
        &crate::ID,
    );
    let (handle_claim, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            HANDLE_SEED,
            normalized_handle_hash.as_ref(),
        ],
        &crate::ID,
    );
    let proposal_manifest_hash = [9_u8; 32];
    let (proposal, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            PROPOSAL_SEED,
            community.as_ref(),
            proposal_manifest_hash.as_ref(),
        ],
        &crate::ID,
    );
    let (vote, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            VOTE_SEED,
            proposal.as_ref(),
            identity.as_ref(),
        ],
        &crate::ID,
    );
    let recovery_request_nonce = [11_u8; 16];
    let (recovery_policy, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_POLICY_SEED,
            identity.as_ref(),
        ],
        &crate::ID,
    );
    let (recovery_request, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_REQUEST_SEED,
            identity.as_ref(),
            recovery_request_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let payment_offering_nonce = [13_u8; 16];
    let payment_receipt_nonce = [14_u8; 16];
    let (payment_config, _) =
        Pubkey::find_program_address(&[PDA_PREFIX, PDA_VERSION, PAYMENT_CONFIG_SEED], &crate::ID);
    let (subscription_offering, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            SUBSCRIPTION_OFFERING_SEED,
            identity.as_ref(),
            payment_offering_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (payment_receipt, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            PAYMENT_RECEIPT_SEED,
            identity.as_ref(),
            payment_receipt_nonce.as_ref(),
        ],
        &crate::ID,
    );
    let (subscription_entitlement, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            SUBSCRIPTION_ENTITLEMENT_SEED,
            subscription_offering.as_ref(),
            identity.as_ref(),
        ],
        &crate::ID,
    );

    assert_eq!(identity, same_identity);
    assert_ne!(identity, other_identity);
    assert_ne!(identity, other_authority_identity);
    assert_ne!(config, identity);
    assert_ne!(identity, post);
    assert_ne!(post, follow);
    assert_ne!(follow, tombstone);
    assert_ne!(tombstone, delegation);
    assert_ne!(delegation, block);
    assert_ne!(block, community);
    assert_ne!(community, membership);
    assert_ne!(membership, reaction);
    assert_ne!(reaction, handle_claim);
    assert_ne!(handle_claim, proposal);
    assert_ne!(proposal, vote);
    assert_ne!(vote, recovery_policy);
    assert_ne!(recovery_policy, recovery_request);
    assert_ne!(recovery_request, payment_config);
    assert_ne!(payment_config, subscription_offering);
    assert_ne!(subscription_offering, payment_receipt);
    assert_ne!(payment_receipt, subscription_entitlement);

    let (same_handle_claim, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            HANDLE_SEED,
            handle_hash(normalized_handle).as_ref(),
        ],
        &crate::ID,
    );
    let (other_handle_claim, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            HANDLE_SEED,
            handle_hash("alice_2").as_ref(),
        ],
        &crate::ID,
    );
    assert_eq!(handle_claim, same_handle_claim);
    assert_ne!(handle_claim, other_handle_claim);

    let (same_proposal, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            PROPOSAL_SEED,
            community.as_ref(),
            proposal_manifest_hash.as_ref(),
        ],
        &crate::ID,
    );
    let (other_proposal, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            PROPOSAL_SEED,
            community.as_ref(),
            [10_u8; 32].as_ref(),
        ],
        &crate::ID,
    );
    let (other_vote, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            VOTE_SEED,
            proposal.as_ref(),
            subject.as_ref(),
        ],
        &crate::ID,
    );
    assert_eq!(proposal, same_proposal);
    assert_ne!(proposal, other_proposal);
    assert_ne!(vote, other_vote);

    let (same_recovery_policy, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_POLICY_SEED,
            identity.as_ref(),
        ],
        &crate::ID,
    );
    let (other_recovery_request, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            RECOVERY_REQUEST_SEED,
            identity.as_ref(),
            [12_u8; 16].as_ref(),
        ],
        &crate::ID,
    );
    assert_eq!(recovery_policy, same_recovery_policy);
    assert_ne!(recovery_request, other_recovery_request);

    let (other_payment_receipt, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            PAYMENT_RECEIPT_SEED,
            identity.as_ref(),
            [15_u8; 16].as_ref(),
        ],
        &crate::ID,
    );
    let (other_subscription_entitlement, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            SUBSCRIPTION_ENTITLEMENT_SEED,
            subscription_offering.as_ref(),
            subject.as_ref(),
        ],
        &crate::ID,
    );
    assert_ne!(payment_receipt, other_payment_receipt);
    assert_ne!(subscription_entitlement, other_subscription_entitlement);
}
