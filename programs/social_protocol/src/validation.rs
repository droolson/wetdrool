use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, BASIS_POINTS_DENOMINATOR, COMMUNITY_ROLE_MEMBER,
        CURRENT_PROFILE_SCHEMA_VERSION, GOVERNANCE_APPROVAL_BPS, GOVERNANCE_QUORUM_BPS,
        MANIFEST_HASH_BYTES, MAX_GOVERNANCE_START_DELAY_SLOTS, MAX_GOVERNANCE_VOTING_SLOTS,
        MAX_HANDLE_BYTES, MAX_MANIFEST_URI_BYTES, MAX_ONCHAIN_PAYMENT_SPLITS, MAX_PROTOCOL_FEE_BPS,
        MAX_RECOVERY_DELAY_SLOTS, MAX_RECOVERY_GUARDIANS, MAX_SUBSCRIPTION_PREPAY_WEEKS,
        MIN_GOVERNANCE_VOTING_SLOTS, MIN_HANDLE_BYTES, MIN_RECOVERY_DELAY_SLOTS,
        MIN_RECOVERY_GUARDIANS, ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH, PDA_PREFIX, PDA_VERSION,
        REACTION_CELEBRATE, REACTION_INSIGHTFUL, REACTION_LIKE, REACTION_SUPPORT,
        VALID_COMMUNITY_ROLES, VALID_DELEGATION_SCOPES, WEEK_SECONDS,
    },
    errors::SocialProtocolError,
    state::{
        Delegation, Identity, PaymentConfig, PaymentSplit, RecoveryPolicy, RecoveryRequest,
        RecoveryRequestState,
    },
};

pub fn handle_hash(handle: &str) -> [u8; MANIFEST_HASH_BYTES] {
    solana_sha256_hasher::hash(handle.as_bytes()).to_bytes()
}

pub fn validate_handle(handle: &str) -> Result<()> {
    let bytes = handle.as_bytes();
    require!(
        (MIN_HANDLE_BYTES..=MAX_HANDLE_BYTES).contains(&bytes.len()),
        SocialProtocolError::InvalidHandleLength
    );
    require!(
        bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_'),
        SocialProtocolError::InvalidHandleCharacter
    );
    require!(
        bytes.first() != Some(&b'_')
            && bytes.last() != Some(&b'_')
            && !bytes.windows(2).any(|window| window == b"__"),
        SocialProtocolError::InvalidHandleFormat
    );
    Ok(())
}

pub fn validate_handle_hash(handle: &str, expected_hash: &[u8; MANIFEST_HASH_BYTES]) -> Result<()> {
    validate_handle(handle)?;
    require!(
        handle_hash(handle) == *expected_hash,
        SocialProtocolError::HandleHashMismatch
    );
    Ok(())
}

pub fn checked_next_sequence(current: u64, expected: u64) -> Result<u64> {
    require_eq!(current, expected, SocialProtocolError::SequenceMismatch);
    current
        .checked_add(1)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))
}

pub fn checked_increment(value: u64) -> Result<u64> {
    value
        .checked_add(1)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))
}

pub fn checked_decrement(value: u64) -> Result<u64> {
    value
        .checked_sub(1)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticUnderflow))
}

pub fn validate_nonzero_hash(hash: &[u8; MANIFEST_HASH_BYTES]) -> Result<()> {
    require!(
        hash.iter().any(|byte| *byte != 0),
        SocialProtocolError::InvalidManifestHash
    );
    Ok(())
}

pub fn validate_profile_schema_version(profile_schema_version: u16) -> Result<()> {
    require_eq!(
        profile_schema_version,
        CURRENT_PROFILE_SCHEMA_VERSION,
        SocialProtocolError::UnsupportedProfileSchemaVersion
    );
    Ok(())
}

pub fn validate_manifest(
    manifest_hash: &[u8; MANIFEST_HASH_BYTES],
    manifest_uri: &str,
) -> Result<()> {
    validate_nonzero_hash(manifest_hash)?;
    validate_manifest_uri(manifest_uri)
}

pub fn validate_delegation_scopes(scopes: u16) -> Result<()> {
    require!(
        scopes != 0 && scopes & !VALID_DELEGATION_SCOPES == 0,
        SocialProtocolError::InvalidDelegationScopes
    );
    Ok(())
}

pub fn authorize_identity_action(
    identity_key: Pubkey,
    identity: &Identity,
    signer: Pubkey,
    delegation: Option<&Delegation>,
    required_scope: u16,
    current_slot: u64,
) -> Result<()> {
    require_eq!(
        identity.version,
        ACCOUNT_VERSION,
        SocialProtocolError::UnsupportedProtocolVersion
    );
    require!(identity.active, SocialProtocolError::IdentityInactive);

    if signer == identity.root_authority {
        return Ok(());
    }

    let scopes =
        validated_delegation_scopes(identity_key, identity, signer, delegation, current_slot)?;
    require!(
        scopes & required_scope == required_scope,
        SocialProtocolError::DelegationScopeMissing
    );
    Ok(())
}

pub fn authorize_identity_action_any_scope(
    identity_key: Pubkey,
    identity: &Identity,
    signer: Pubkey,
    delegation: Option<&Delegation>,
    permitted_scopes: u16,
    current_slot: u64,
) -> Result<()> {
    require_eq!(
        identity.version,
        ACCOUNT_VERSION,
        SocialProtocolError::UnsupportedProtocolVersion
    );
    require!(identity.active, SocialProtocolError::IdentityInactive);
    require!(
        permitted_scopes != 0 && permitted_scopes & !VALID_DELEGATION_SCOPES == 0,
        SocialProtocolError::InvalidDelegationScopes
    );

    if signer == identity.root_authority {
        return Ok(());
    }

    let scopes =
        validated_delegation_scopes(identity_key, identity, signer, delegation, current_slot)?;
    require!(
        scopes & permitted_scopes != 0,
        SocialProtocolError::DelegationScopeMissing
    );
    Ok(())
}

fn validated_delegation_scopes(
    identity_key: Pubkey,
    identity: &Identity,
    signer: Pubkey,
    delegation: Option<&Delegation>,
    current_slot: u64,
) -> Result<u16> {
    let delegation = delegation.ok_or_else(|| error!(SocialProtocolError::Unauthorized))?;
    require_eq!(
        delegation.version,
        ACCOUNT_VERSION,
        SocialProtocolError::UnsupportedProtocolVersion
    );
    require_keys_eq!(
        delegation.config,
        identity.config,
        SocialProtocolError::DelegationSubstitution
    );
    require_keys_eq!(
        delegation.identity,
        identity_key,
        SocialProtocolError::DelegationSubstitution
    );
    require_keys_eq!(
        delegation.delegate_authority,
        signer,
        SocialProtocolError::DelegationSubstitution
    );
    require_keys_eq!(
        delegation.issued_by_root_authority,
        identity.root_authority,
        SocialProtocolError::DelegationIssuerSuperseded
    );
    require_eq!(
        delegation.issued_at_root_rotation_count,
        identity.root_rotation_count,
        SocialProtocolError::DelegationIssuerSuperseded
    );
    require!(
        delegation.active && delegation.revoked_at_slot.is_none(),
        SocialProtocolError::DelegationRevoked
    );
    require!(
        current_slot <= delegation.expires_at_slot,
        SocialProtocolError::DelegationExpired
    );
    validate_delegation_scopes(delegation.scopes)?;
    Ok(delegation.scopes)
}

pub fn validate_community_roles(active: bool, roles: u16) -> Result<()> {
    let valid_active_roles =
        roles != 0 && roles & COMMUNITY_ROLE_MEMBER != 0 && roles & !VALID_COMMUNITY_ROLES == 0;
    require!(
        (active && valid_active_roles) || (!active && roles == 0),
        SocialProtocolError::InvalidCommunityRoles
    );
    Ok(())
}

pub fn validate_reaction_kind(reaction_kind: u8) -> Result<()> {
    require!(
        matches!(
            reaction_kind,
            REACTION_LIKE | REACTION_CELEBRATE | REACTION_INSIGHTFUL | REACTION_SUPPORT
        ),
        SocialProtocolError::InvalidReactionKind
    );
    Ok(())
}

pub fn validate_manifest_uri(manifest_uri: &str) -> Result<()> {
    let uri_bytes = manifest_uri.as_bytes();
    require!(!uri_bytes.is_empty(), SocialProtocolError::EmptyManifestUri);
    require!(
        uri_bytes.len() <= MAX_MANIFEST_URI_BYTES,
        SocialProtocolError::ManifestUriTooLong
    );
    require!(
        uri_bytes.iter().all(|byte| {
            byte.is_ascii_graphic() && !matches!(*byte, b'<' | b'>' | b'"' | b'\'' | b'\\')
        }),
        SocialProtocolError::UnsafeManifestUri
    );

    require!(
        manifest_uri_cid(manifest_uri).is_some(),
        SocialProtocolError::UnsupportedManifestUri
    );

    Ok(())
}

fn manifest_uri_cid(manifest_uri: &str) -> Option<&str> {
    if let Some(cid) = manifest_uri.strip_prefix("ipfs://") {
        return is_manifest_cid(cid).then_some(cid);
    }
    if let Some(cid) = manifest_uri.strip_prefix("local://") {
        return is_manifest_cid(cid).then_some(cid);
    }
    if let Some(locator) = manifest_uri.strip_prefix("ar://") {
        let (transaction_id, cid) = locator.split_once('/')?;
        return (is_arweave_transaction_id(transaction_id) && is_manifest_cid(cid)).then_some(cid);
    }
    if let Some(locator) = manifest_uri.strip_prefix("https://") {
        if locator.contains('?') || locator.contains('#') {
            return None;
        }
        let (authority, path) = locator.split_once('/')?;
        if !is_https_authority(authority) {
            return None;
        }
        let mut segments = path.split('/');
        let mut last = segments.next()?;
        if last.is_empty() {
            return None;
        }
        for segment in segments {
            if segment.is_empty() {
                return None;
            }
            last = segment;
        }
        return is_manifest_cid(last).then_some(last);
    }
    None
}

fn is_manifest_cid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 59
        && bytes.starts_with(b"bafkrei")
        && bytes
            .get(7)
            .is_some_and(|byte| (b'a'..=b'h').contains(byte))
        && bytes[8..58]
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(byte))
        && bytes.last().is_some_and(|byte| {
            matches!(*byte, b'a' | b'e' | b'i' | b'm' | b'q' | b'u' | b'y' | b'4')
        })
}

fn is_arweave_transaction_id(value: &str) -> bool {
    value.len() == 43
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'-'))
}

fn is_https_authority(value: &str) -> bool {
    let (host, port) = match value.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (value, None),
    };
    if host.is_empty()
        || host.contains(':')
        || host.split('.').any(|label| {
            label.is_empty()
                || !label
                    .as_bytes()
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
                || !label
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                || !label
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
        })
    {
        return false;
    }
    match port {
        None => true,
        Some(port) => {
            (1..=5).contains(&port.len())
                && port.as_bytes().iter().all(u8::is_ascii_digit)
                && port.parse::<u16>().is_ok_and(|value| value != 0)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GovernanceTally {
    pub participating_votes: u64,
    pub decisive_votes: u64,
    pub quorum_met: bool,
    pub approval_met: bool,
}

pub fn validate_governance_commitment(
    strategy_hash: &[u8; MANIFEST_HASH_BYTES],
    quorum_bps: u16,
    approval_bps: u16,
) -> Result<()> {
    require!(
        *strategy_hash == ONE_ACTIVE_MEMBER_ONE_VOTE_STRATEGY_HASH,
        SocialProtocolError::UnsupportedGovernanceStrategy
    );
    require!(
        quorum_bps == GOVERNANCE_QUORUM_BPS && approval_bps == GOVERNANCE_APPROVAL_BPS,
        SocialProtocolError::GovernanceThresholdMismatch
    );
    Ok(())
}

pub fn validate_proposal_window(
    current_slot: u64,
    opens_at_slot: u64,
    closes_at_slot: u64,
) -> Result<()> {
    require!(
        opens_at_slot >= current_slot,
        SocialProtocolError::InvalidProposalWindow
    );
    let start_delay = opens_at_slot
        .checked_sub(current_slot)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticUnderflow))?;
    require!(
        start_delay <= MAX_GOVERNANCE_START_DELAY_SLOTS,
        SocialProtocolError::ProposalStartTooFar
    );
    let duration = closes_at_slot
        .checked_sub(opens_at_slot)
        .ok_or_else(|| error!(SocialProtocolError::InvalidProposalWindow))?;
    require!(
        (MIN_GOVERNANCE_VOTING_SLOTS..=MAX_GOVERNANCE_VOTING_SLOTS).contains(&duration),
        SocialProtocolError::InvalidProposalWindow
    );
    Ok(())
}

pub fn validate_membership_snapshot(
    membership_updated_at_slot: u64,
    membership_authority_sequence: u64,
    proposal_created_at_slot: u64,
    proposal_proposer_sequence: u64,
) -> Result<()> {
    require!(
        membership_updated_at_slot <= proposal_created_at_slot
            && membership_authority_sequence < proposal_proposer_sequence,
        SocialProtocolError::MemberNotEligibleAtSnapshot
    );
    Ok(())
}

pub fn calculate_governance_tally(
    eligible_member_count: u64,
    yes_votes: u64,
    no_votes: u64,
    abstain_votes: u64,
    quorum_bps: u16,
    approval_bps: u16,
) -> Result<GovernanceTally> {
    require!(
        eligible_member_count > 0,
        SocialProtocolError::NoEligibleCommunityMembers
    );
    require!(
        u128::from(quorum_bps) <= BASIS_POINTS_DENOMINATOR
            && u128::from(approval_bps) <= BASIS_POINTS_DENOMINATOR,
        SocialProtocolError::GovernanceThresholdMismatch
    );

    let decisive_votes = yes_votes
        .checked_add(no_votes)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
    let participating_votes = decisive_votes
        .checked_add(abstain_votes)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
    require!(
        participating_votes <= eligible_member_count,
        SocialProtocolError::GovernanceCountInvariant
    );

    let quorum_lhs = u128::from(participating_votes)
        .checked_mul(BASIS_POINTS_DENOMINATOR)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
    let quorum_rhs = u128::from(eligible_member_count)
        .checked_mul(u128::from(quorum_bps))
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
    let quorum_met = quorum_lhs >= quorum_rhs;

    let approval_met = if decisive_votes == 0 {
        false
    } else {
        let approval_lhs = u128::from(yes_votes)
            .checked_mul(BASIS_POINTS_DENOMINATOR)
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
        let approval_rhs = u128::from(decisive_votes)
            .checked_mul(u128::from(approval_bps))
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
        approval_lhs >= approval_rhs
    };

    Ok(GovernanceTally {
        participating_votes,
        decisive_votes,
        quorum_met,
        approval_met,
    })
}

pub fn validate_recovery_policy(
    current_root_authority: Pubkey,
    guardians: &[Pubkey],
    threshold: u8,
    delay_slots: u64,
) -> Result<()> {
    require!(
        (MIN_RECOVERY_GUARDIANS..=MAX_RECOVERY_GUARDIANS).contains(&guardians.len()),
        SocialProtocolError::InvalidRecoveryPolicy
    );
    require!(
        (MIN_RECOVERY_DELAY_SLOTS..=MAX_RECOVERY_DELAY_SLOTS).contains(&delay_slots),
        SocialProtocolError::InvalidRecoveryDelay
    );
    require!(
        usize::from(threshold) >= MIN_RECOVERY_GUARDIANS
            && usize::from(threshold) <= guardians.len(),
        SocialProtocolError::InvalidRecoveryThreshold
    );
    for (index, guardian) in guardians.iter().enumerate() {
        require!(
            *guardian != Pubkey::default() && *guardian != current_root_authority,
            SocialProtocolError::InvalidRecoveryGuardian
        );
        require!(
            !guardians[..index].contains(guardian),
            SocialProtocolError::DuplicateRecoveryGuardian
        );
    }
    Ok(())
}

pub fn recovery_guardian_index(policy: &RecoveryPolicy, guardian: Pubkey) -> Result<u8> {
    require!(policy.active, SocialProtocolError::RecoveryPolicyDisabled);
    let index = policy
        .guardians
        .iter()
        .position(|candidate| *candidate == guardian)
        .ok_or_else(|| error!(SocialProtocolError::RecoveryGuardianNotAuthorized))?;
    u8::try_from(index).map_err(|_| error!(SocialProtocolError::ArithmeticOverflow))
}

pub fn checked_recovery_execute_after(requested_at_slot: u64, delay_slots: u64) -> Result<u64> {
    require!(
        (MIN_RECOVERY_DELAY_SLOTS..=MAX_RECOVERY_DELAY_SLOTS).contains(&delay_slots),
        SocialProtocolError::InvalidRecoveryDelay
    );
    requested_at_slot
        .checked_add(delay_slots)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))
}

pub fn validate_recovery_target(
    current_root_authority: Pubkey,
    target_root_authority: Pubkey,
) -> Result<()> {
    require!(
        target_root_authority != Pubkey::default()
            && target_root_authority != current_root_authority,
        SocialProtocolError::InvalidRecoveryTarget
    );
    Ok(())
}

pub fn validate_recovery_approval_invariant(request: &RecoveryRequest) -> Result<()> {
    require!(
        usize::from(request.guardian_count) >= MIN_RECOVERY_GUARDIANS
            && usize::from(request.guardian_count) <= MAX_RECOVERY_GUARDIANS,
        SocialProtocolError::RecoveryApprovalInvariant
    );
    require!(
        usize::from(request.threshold) >= MIN_RECOVERY_GUARDIANS
            && request.threshold <= request.guardian_count,
        SocialProtocolError::RecoveryApprovalInvariant
    );
    let allowed_mask = ((1_u16 << request.guardian_count) - 1) as u8;
    require!(
        request.approvals_mask & !allowed_mask == 0
            && request.approval_count == request.approvals_mask.count_ones() as u8
            && request.approval_count <= request.guardian_count,
        SocialProtocolError::RecoveryApprovalInvariant
    );
    Ok(())
}

pub fn record_recovery_approval(request: &mut RecoveryRequest, guardian_index: u8) -> Result<u8> {
    validate_recovery_approval_invariant(request)?;
    require!(
        guardian_index < request.guardian_count,
        SocialProtocolError::RecoveryGuardianNotAuthorized
    );
    let approval_bit = 1_u8
        .checked_shl(u32::from(guardian_index))
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
    require!(
        request.approvals_mask & approval_bit == 0,
        SocialProtocolError::RecoveryGuardianAlreadyApproved
    );
    request.approvals_mask |= approval_bit;
    request.approval_count = request
        .approval_count
        .checked_add(1)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
    validate_recovery_approval_invariant(request)?;
    Ok(request.approval_count)
}

pub fn validate_recovery_request_current(
    identity: &Identity,
    policy: &RecoveryPolicy,
    request: &RecoveryRequest,
) -> Result<()> {
    require!(
        request.state == RecoveryRequestState::Pending && request.terminal_at_slot.is_none(),
        SocialProtocolError::RecoveryRequestAlreadyTerminal
    );
    require!(policy.active, SocialProtocolError::RecoveryPolicyDisabled);
    require_eq!(
        request.policy_sequence,
        policy.policy_sequence,
        SocialProtocolError::RecoveryRequestStalePolicy
    );
    require_keys_eq!(
        request.current_root_authority,
        identity.root_authority,
        SocialProtocolError::RecoveryRequestStaleRoot
    );
    require_eq!(
        request.identity_sequence,
        identity.sequence,
        SocialProtocolError::RecoveryRequestStaleIdentitySequence
    );
    require_eq!(
        request.root_rotation_count,
        identity.root_rotation_count,
        SocialProtocolError::RecoveryRequestStaleEpoch
    );
    require!(
        request.threshold == policy.threshold
            && usize::from(request.guardian_count) == policy.guardians.len(),
        SocialProtocolError::RecoveryRequestStalePolicy
    );
    validate_recovery_policy(
        identity.root_authority,
        &policy.guardians,
        policy.threshold,
        policy.delay_slots,
    )?;
    validate_recovery_approval_invariant(request)?;
    validate_recovery_target(
        request.current_root_authority,
        request.target_root_authority,
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WokePaymentAllocation {
    pub fee_lamports: u64,
    pub distributable_lamports: u64,
    pub recipient_amounts: Vec<u64>,
}

pub fn validate_protocol_fee(fee_bps: u16) -> Result<()> {
    require!(
        fee_bps <= MAX_PROTOCOL_FEE_BPS,
        SocialProtocolError::InvalidProtocolFee
    );
    Ok(())
}

pub fn validate_payment_config_snapshot(
    payment_config: &PaymentConfig,
    expected_policy_sequence: u64,
    expected_fee_bps: u16,
    expected_fee_destination: Pubkey,
) -> Result<()> {
    require!(
        payment_config.enabled,
        SocialProtocolError::PaymentsDisabled
    );
    require_eq!(
        payment_config.policy_sequence,
        expected_policy_sequence,
        SocialProtocolError::PaymentPolicySequenceMismatch
    );
    require_eq!(
        payment_config.fee_bps,
        expected_fee_bps,
        SocialProtocolError::InvalidProtocolFee
    );
    require_keys_eq!(
        payment_config.fee_destination,
        expected_fee_destination,
        SocialProtocolError::PaymentConfigSubstitution
    );
    validate_protocol_fee(payment_config.fee_bps)
}

pub fn validate_payment_nonce(nonce: &[u8]) -> Result<()> {
    require!(
        nonce.iter().any(|byte| *byte != 0),
        SocialProtocolError::InvalidPaymentNonce
    );
    Ok(())
}

pub fn validate_payment_identity(
    identity_key: Pubkey,
    identity: &Identity,
    config_key: Pubkey,
    destination: Pubkey,
) -> Result<()> {
    require_eq!(
        identity.version,
        crate::constants::ACCOUNT_VERSION,
        SocialProtocolError::UnsupportedProtocolVersion
    );
    require_keys_eq!(
        identity.config,
        config_key,
        SocialProtocolError::PaymentRecipientSubstitution
    );
    require!(
        identity.active,
        SocialProtocolError::InvalidPaymentRecipient
    );
    require_keys_eq!(
        identity.root_authority,
        destination,
        SocialProtocolError::PaymentRecipientSubstitution
    );
    let (expected_identity, _) = Pubkey::find_program_address(
        &[
            PDA_PREFIX,
            PDA_VERSION,
            crate::constants::IDENTITY_SEED,
            identity.origin_authority.as_ref(),
            identity.identity_nonce.as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(
        identity_key,
        expected_identity,
        SocialProtocolError::PaymentRecipientSubstitution
    );
    Ok(())
}

pub fn validate_payment_source(
    payer_identity_key: Pubkey,
    payer_identity: &Identity,
    config_key: Pubkey,
    payer_authority: Pubkey,
    expected_root_rotation_count: u64,
) -> Result<()> {
    validate_payment_identity(
        payer_identity_key,
        payer_identity,
        config_key,
        payer_authority,
    )
    .map_err(|_| error!(SocialProtocolError::PaymentSourceSubstitution))?;
    require_eq!(
        payer_identity.root_rotation_count,
        expected_root_rotation_count,
        SocialProtocolError::PaymentSourceSubstitution
    );
    Ok(())
}

pub fn validate_subscription_splits(
    splits: &[PaymentSplit],
    creator_identity: Pubkey,
    creator_root_authority: Pubkey,
) -> Result<u8> {
    validate_payment_split_shape(splits)?;
    let creator_index = splits
        .iter()
        .position(|split| {
            split.recipient_identity == creator_identity
                && split.destination == creator_root_authority
        })
        .ok_or_else(|| error!(SocialProtocolError::InvalidPaymentSplits))?;
    u8::try_from(creator_index).map_err(|_| error!(SocialProtocolError::ArithmeticOverflow))
}

pub fn validate_payment_split_shape(splits: &[PaymentSplit]) -> Result<()> {
    require!(
        (1..=MAX_ONCHAIN_PAYMENT_SPLITS).contains(&splits.len()),
        SocialProtocolError::InvalidPaymentSplits
    );

    let mut basis_point_total = 0_u32;
    for (index, split) in splits.iter().enumerate() {
        require!(
            split.basis_points > 0,
            SocialProtocolError::InvalidPaymentSplits
        );
        basis_point_total = basis_point_total
            .checked_add(u32::from(split.basis_points))
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
        require!(
            split.recipient_identity != Pubkey::default() && split.destination != Pubkey::default(),
            SocialProtocolError::InvalidPaymentRecipient
        );

        if let Some(previous) = index.checked_sub(1).and_then(|prior| splits.get(prior)) {
            require!(
                previous.recipient_identity.to_bytes() < split.recipient_identity.to_bytes(),
                SocialProtocolError::DuplicateOrUnorderedPaymentRecipient
            );
        }
        require!(
            splits[..index]
                .iter()
                .all(|prior| prior.destination != split.destination),
            SocialProtocolError::DuplicatePaymentDestination
        );
    }
    require_eq!(
        basis_point_total,
        crate::constants::BASIS_POINTS_DENOMINATOR as u32,
        SocialProtocolError::InvalidPaymentSplits
    );
    Ok(())
}

pub fn validate_payment_aliases(
    payer_identity: Pubkey,
    payer_authority: Pubkey,
    fee_destination: Pubkey,
    splits: &[PaymentSplit],
) -> Result<()> {
    require!(
        payer_authority != fee_destination
            && splits.iter().all(|split| {
                split.recipient_identity != payer_identity
                    && split.destination != payer_authority
                    && split.destination != fee_destination
            }),
        SocialProtocolError::PaymentDestinationAlias
    );
    Ok(())
}

pub fn calculate_native_payment_allocation(
    gross_lamports: u64,
    fee_bps: u16,
    splits: &[PaymentSplit],
) -> Result<WokePaymentAllocation> {
    require!(
        gross_lamports > 0,
        SocialProtocolError::InvalidPaymentAmount
    );
    validate_protocol_fee(fee_bps)?;
    validate_payment_split_shape(splits)?;

    let gross = u128::from(gross_lamports);
    let denominator = BASIS_POINTS_DENOMINATOR;
    let fee = gross
        .checked_mul(u128::from(fee_bps))
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?
        .checked_div(denominator)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticUnderflow))?;
    let distributable = gross
        .checked_sub(fee)
        .ok_or_else(|| error!(SocialProtocolError::ArithmeticUnderflow))?;
    require!(
        distributable > 0,
        SocialProtocolError::PaymentRoundingUnderflow
    );

    let mut amounts = Vec::with_capacity(splits.len());
    let mut remainders = Vec::with_capacity(splits.len());
    for split in splits {
        let numerator = distributable
            .checked_mul(u128::from(split.basis_points))
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
        amounts.push(
            numerator
                .checked_div(denominator)
                .ok_or_else(|| error!(SocialProtocolError::ArithmeticUnderflow))?,
        );
        remainders.push(
            numerator
                .checked_rem(denominator)
                .ok_or_else(|| error!(SocialProtocolError::ArithmeticUnderflow))?,
        );
    }

    let allocated = amounts.iter().try_fold(0_u128, |sum, amount| {
        sum.checked_add(*amount)
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))
    })?;
    let mut residual = distributable
        .checked_sub(allocated)
        .ok_or_else(|| error!(SocialProtocolError::PaymentConservationInvariant))?;
    let mut order: Vec<usize> = (0..splits.len()).collect();
    order.sort_by(|left, right| {
        remainders[*right].cmp(&remainders[*left]).then_with(|| {
            splits[*left]
                .recipient_identity
                .to_bytes()
                .cmp(&splits[*right].recipient_identity.to_bytes())
        })
    });
    for index in order {
        if residual == 0 {
            break;
        }
        amounts[index] = amounts[index]
            .checked_add(1)
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?;
        residual = residual
            .checked_sub(1)
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticUnderflow))?;
    }
    require_eq!(
        residual,
        0,
        SocialProtocolError::PaymentConservationInvariant
    );
    require!(
        amounts.iter().all(|amount| *amount > 0),
        SocialProtocolError::PaymentRoundingUnderflow
    );
    let recipient_total = amounts.iter().try_fold(0_u128, |sum, amount| {
        sum.checked_add(*amount)
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))
    })?;
    require_eq!(
        fee.checked_add(recipient_total)
            .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?,
        gross,
        SocialProtocolError::PaymentConservationInvariant
    );

    Ok(WokePaymentAllocation {
        fee_lamports: u64::try_from(fee)
            .map_err(|_| error!(SocialProtocolError::ArithmeticOverflow))?,
        distributable_lamports: u64::try_from(distributable)
            .map_err(|_| error!(SocialProtocolError::ArithmeticOverflow))?,
        recipient_amounts: amounts
            .into_iter()
            .map(|amount| {
                u64::try_from(amount).map_err(|_| error!(SocialProtocolError::ArithmeticOverflow))
            })
            .collect::<Result<Vec<_>>>()?,
    })
}

pub fn calculate_subscription_window(
    now_timestamp: i64,
    prior_valid_until_timestamp: i64,
) -> Result<(i64, i64)> {
    require!(
        now_timestamp >= 0 && prior_valid_until_timestamp >= 0,
        SocialProtocolError::InvalidPaymentTimestamp
    );
    let from_timestamp = now_timestamp.max(prior_valid_until_timestamp);
    let until_timestamp = from_timestamp
        .checked_add(WEEK_SECONDS)
        .ok_or_else(|| error!(SocialProtocolError::InvalidPaymentTimestamp))?;
    let maximum_valid_until = now_timestamp
        .checked_add(
            WEEK_SECONDS
                .checked_mul(MAX_SUBSCRIPTION_PREPAY_WEEKS)
                .ok_or_else(|| error!(SocialProtocolError::ArithmeticOverflow))?,
        )
        .ok_or_else(|| error!(SocialProtocolError::InvalidPaymentTimestamp))?;
    require!(
        until_timestamp <= maximum_valid_until,
        SocialProtocolError::SubscriptionPrepaymentLimit
    );
    Ok((from_timestamp, until_timestamp))
}
