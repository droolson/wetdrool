use anchor_lang::prelude::*;

#[error_code]
pub enum SocialProtocolError {
    #[msg("The protocol configuration version is unsupported")]
    UnsupportedProtocolVersion,
    #[msg("The provided account does not belong to the expected protocol object")]
    AccountSubstitution,
    #[msg("The signer is not authorized for this identity")]
    Unauthorized,
    #[msg("The identity is inactive")]
    IdentityInactive,
    #[msg("The expected identity sequence does not match current state")]
    SequenceMismatch,
    #[msg("A checked counter or sequence overflowed")]
    ArithmeticOverflow,
    #[msg("A manifest hash cannot be all zeroes")]
    InvalidManifestHash,
    #[msg("The profile manifest schema version is unsupported")]
    UnsupportedProfileSchemaVersion,
    #[msg("A manifest URI cannot be empty")]
    EmptyManifestUri,
    #[msg("The manifest URI exceeds the onchain byte limit")]
    ManifestUriTooLong,
    #[msg("The manifest URI scheme is unsupported")]
    UnsupportedManifestUri,
    #[msg("The manifest URI contains unsafe or non-ASCII bytes")]
    UnsafeManifestUri,
    #[msg("An identity cannot follow itself")]
    CannotFollowSelf,
    #[msg("The follow edge is already active")]
    AlreadyFollowing,
    #[msg("The follow edge is not active")]
    NotFollowing,
    #[msg("The follow edge state does not match its PDA identities")]
    FollowEdgeSubstitution,
    #[msg("The post is already tombstoned")]
    PostAlreadyTombstoned,
    #[msg("The tombstone target hash does not match the post manifest hash")]
    TombstoneTargetMismatch,
    #[msg("The replacement root authority is invalid")]
    InvalidRootAuthority,
    #[msg("A delegation scope mask is empty or contains unsupported bits")]
    InvalidDelegationScopes,
    #[msg("The delegation sequence is not the next monotonic sequence")]
    DelegationSequenceMismatch,
    #[msg("The delegation has expired")]
    DelegationExpired,
    #[msg("The delegation has been revoked")]
    DelegationRevoked,
    #[msg("The delegation does not grant the required scope")]
    DelegationScopeMissing,
    #[msg("The delegation state does not belong to the expected identity and signer")]
    DelegationSubstitution,
    #[msg("The delegation was issued under a superseded root authority epoch")]
    DelegationIssuerSuperseded,
    #[msg("The delegation is already revoked")]
    DelegationAlreadyRevoked,
    #[msg("An identity cannot block itself")]
    CannotBlockSelf,
    #[msg("The block edge is already active")]
    AlreadyBlocked,
    #[msg("The block edge is not active")]
    NotBlocked,
    #[msg("The block edge state does not match its PDA identities")]
    BlockEdgeSubstitution,
    #[msg("The governance strategy version must advance by exactly one")]
    GovernanceVersionMismatch,
    #[msg("The governance strategy version must be non-zero")]
    InvalidGovernanceVersion,
    #[msg("The community role mask is invalid for the requested membership state")]
    InvalidCommunityRoles,
    #[msg("The membership is already in the requested state")]
    MembershipStateUnchanged,
    #[msg("The community or membership account was substituted")]
    CommunitySubstitution,
    #[msg("A checked counter could not be decremented")]
    ArithmeticUnderflow,
    #[msg("The reaction kind is unsupported")]
    InvalidReactionKind,
    #[msg("The reaction is already active")]
    AlreadyReacted,
    #[msg("The reaction is not active")]
    ReactionInactive,
    #[msg("The reaction account was substituted")]
    ReactionSubstitution,
    #[msg("A tombstoned post cannot receive a new reaction")]
    PostTombstoned,
    #[msg("A handle must contain between 3 and 30 ASCII bytes")]
    InvalidHandleLength,
    #[msg("A handle may contain only lowercase ASCII letters, digits, and underscores")]
    InvalidHandleCharacter,
    #[msg("A handle cannot begin or end with an underscore or contain repeated underscores")]
    InvalidHandleFormat,
    #[msg("The provided handle digest does not match the normalized handle")]
    HandleHashMismatch,
    #[msg("The normalized handle is already claimed")]
    HandleAlreadyClaimed,
    #[msg("The handle digest is occupied by a different normalized handle")]
    HandleHashCollision,
    #[msg("The handle claim account was substituted")]
    HandleClaimSubstitution,
    #[msg("The community does not commit to the supported one-active-member-one-vote strategy")]
    UnsupportedGovernanceStrategy,
    #[msg("The proposal thresholds do not match the committed governance strategy")]
    GovernanceThresholdMismatch,
    #[msg("A governance proposal requires at least one eligible active member")]
    NoEligibleCommunityMembers,
    #[msg("The proposal voting window is invalid or outside its bounded duration")]
    InvalidProposalWindow,
    #[msg("The proposal voting window starts too far in the future")]
    ProposalStartTooFar,
    #[msg("A proposal with this community and manifest digest already exists")]
    ProposalAlreadyExists,
    #[msg("The governance proposal account or relationship was substituted")]
    ProposalSubstitution,
    #[msg("The expected community sequence does not match current state")]
    CommunitySequenceMismatch,
    #[msg("The proposal voting window has not opened")]
    ProposalNotOpen,
    #[msg("The proposal voting window is closed")]
    ProposalVotingClosed,
    #[msg("The proposal has already been finalized")]
    ProposalAlreadyFinalized,
    #[msg("The proposal cannot be finalized before its voting window closes")]
    ProposalFinalizationTooEarly,
    #[msg("This identity has already cast its immutable vote on the proposal")]
    VoteAlreadyCast,
    #[msg("The governance vote account or relationship was substituted")]
    VoteSubstitution,
    #[msg("The voter does not have an active community membership")]
    InactiveCommunityMember,
    #[msg("The membership was not continuously eligible at the proposal snapshot")]
    MemberNotEligibleAtSnapshot,
    #[msg("The proposal snapshot has no remaining eligible vote capacity")]
    EligibleVoteCapacityReached,
    #[msg("The expected proposal sequence does not match current state")]
    ProposalSequenceMismatch,
    #[msg("The stored governance vote counts violate proposal invariants")]
    GovernanceCountInvariant,
    #[msg("The expected membership state sequence does not match current state")]
    MembershipSequenceMismatch,
    #[msg("A recovery policy requires a bounded set of distinct guardians")]
    InvalidRecoveryPolicy,
    #[msg("A recovery guardian is invalid or conflicts with the current root")]
    InvalidRecoveryGuardian,
    #[msg("A recovery policy cannot contain duplicate guardians")]
    DuplicateRecoveryGuardian,
    #[msg("The recovery approval threshold is invalid")]
    InvalidRecoveryThreshold,
    #[msg("The recovery delay is outside the supported slot bounds")]
    InvalidRecoveryDelay,
    #[msg("The expected recovery policy sequence does not match current state")]
    RecoveryPolicySequenceMismatch,
    #[msg("The recovery policy is disabled")]
    RecoveryPolicyDisabled,
    #[msg("The recovery policy is already disabled")]
    RecoveryPolicyAlreadyDisabled,
    #[msg("The recovery policy account or relationship was substituted")]
    RecoveryPolicySubstitution,
    #[msg("The recovery request account or relationship was substituted")]
    RecoveryRequestSubstitution,
    #[msg("The recovery request is already terminal")]
    RecoveryRequestAlreadyTerminal,
    #[msg("The recovery request was created under a stale policy sequence")]
    RecoveryRequestStalePolicy,
    #[msg("The recovery request was created for a displaced root authority")]
    RecoveryRequestStaleRoot,
    #[msg("The recovery request identity sequence is stale")]
    RecoveryRequestStaleIdentitySequence,
    #[msg("The recovery request root-rotation epoch is stale")]
    RecoveryRequestStaleEpoch,
    #[msg("The signer is not a guardian in the active recovery policy")]
    RecoveryGuardianNotAuthorized,
    #[msg("This guardian has already approved the recovery request")]
    RecoveryGuardianAlreadyApproved,
    #[msg("The recovery approval bitmap or count is inconsistent")]
    RecoveryApprovalInvariant,
    #[msg("The recovery execution delay has not elapsed")]
    RecoveryTooEarly,
    #[msg("The recovery request has insufficient distinct guardian approvals")]
    RecoveryThresholdNotMet,
    #[msg("The recovery target root authority is invalid")]
    InvalidRecoveryTarget,
    #[msg("A recovery request nonce cannot be all zeroes")]
    InvalidRecoveryNonce,
    #[msg("Only the verified program upgrade authority may bootstrap payment configuration")]
    UnauthorizedPaymentBootstrap,
    #[msg("The payment configuration account or relationship was substituted")]
    PaymentConfigSubstitution,
    #[msg("The signer is not the configured payment policy authority")]
    UnauthorizedPaymentConfig,
    #[msg("The expected payment policy sequence does not match current state")]
    PaymentPolicySequenceMismatch,
    #[msg("The protocol fee is outside the supported basis-point range")]
    InvalidProtocolFee,
    #[msg("Native WOKE payments are currently disabled")]
    PaymentsDisabled,
    #[msg("The replacement payment authority is invalid")]
    InvalidPaymentAuthority,
    #[msg("A payment receipt nonce cannot be all zeroes")]
    InvalidPaymentNonce,
    #[msg("The native WOKE payment amount is invalid")]
    InvalidPaymentAmount,
    #[msg("The payment split set is malformed or outside the onchain bound")]
    InvalidPaymentSplits,
    #[msg("Payment recipient identities must be distinct and canonically ordered")]
    DuplicateOrUnorderedPaymentRecipient,
    #[msg("Payment destinations must be distinct")]
    DuplicatePaymentDestination,
    #[msg("A payment recipient identity is invalid or inactive")]
    InvalidPaymentRecipient,
    #[msg("A payment recipient identity or destination account was substituted")]
    PaymentRecipientSubstitution,
    #[msg("The payment source does not match the payer identity's current root authority")]
    PaymentSourceSubstitution,
    #[msg("The payment source, fee destination, and recipient destinations must not alias")]
    PaymentDestinationAlias,
    #[msg("The payment amount cannot give every declared recipient one base unit")]
    PaymentRoundingUnderflow,
    #[msg("The calculated payment transfers do not conserve the gross amount")]
    PaymentConservationInvariant,
    #[msg("A subscription offering with this creator and nonce already exists")]
    SubscriptionOfferingAlreadyExists,
    #[msg("The subscription offering account or relationship was substituted")]
    SubscriptionOfferingSubstitution,
    #[msg("The subscription offering is inactive")]
    SubscriptionOfferingInactive,
    #[msg("The subscription offering is already retired")]
    SubscriptionOfferingAlreadyRetired,
    #[msg("The subscription offering was created under a superseded creator root epoch")]
    SubscriptionOfferingStaleCreator,
    #[msg("The expected subscription offering state sequence does not match")]
    SubscriptionOfferingSequenceMismatch,
    #[msg("The signed subscription terms differ from the immutable offering")]
    SubscriptionTermsMismatch,
    #[msg("A permanent payment receipt already occupies this payer nonce")]
    PaymentReceiptAlreadyExists,
    #[msg("The payment receipt account or relationship was substituted")]
    PaymentReceiptSubstitution,
    #[msg("The subscription entitlement account or relationship was substituted")]
    EntitlementSubstitution,
    #[msg("The expected subscription entitlement sequence does not match")]
    EntitlementSequenceMismatch,
    #[msg("The validator clock cannot produce a valid subscription period")]
    InvalidPaymentTimestamp,
    #[msg("The subscription would exceed the bounded prepayment horizon")]
    SubscriptionPrepaymentLimit,
}
