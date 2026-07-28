CREATE TABLE payment_configs (
  network_id text PRIMARY KEY
    REFERENCES protocol_configs(network_id) ON DELETE CASCADE,
  payment_config_address text NOT NULL,
  upgrade_authority text NOT NULL,
  authority text NOT NULL,
  fee_destination text NOT NULL,
  fee_bps smallint NOT NULL CHECK (fee_bps BETWEEN 0 AND 1000),
  policy_sequence numeric(20, 0) NOT NULL
    CHECK (policy_sequence BETWEEN 1 AND 18446744073709551615),
  enabled boolean NOT NULL,
  initialized_slot numeric(20, 0) NOT NULL
    CHECK (initialized_slot BETWEEN 0 AND 18446744073709551615),
  initialized_at timestamptz NOT NULL,
  updated_slot numeric(20, 0) NOT NULL
    CHECK (updated_slot BETWEEN initialized_slot AND 18446744073709551615),
  updated_at timestamptz NOT NULL,
  transaction_signature text NOT NULL,
  transaction_index integer CHECK (transaction_index IS NULL OR transaction_index >= 0),
  log_index integer NOT NULL CHECK (log_index >= 0),
  CONSTRAINT payment_configs_network_address_key
    UNIQUE (network_id, payment_config_address)
);

CREATE TABLE subscription_offerings (
  network_id text NOT NULL,
  offering_address text NOT NULL,
  payment_config_address text NOT NULL,
  creator_identity_id text NOT NULL,
  root_authority text NOT NULL,
  offering_nonce text NOT NULL
    CHECK (offering_nonce ~ '^[0-9a-f]{32}$' AND offering_nonce <> repeat('0', 32)),
  manifest_hash text NOT NULL
    CHECK (manifest_hash <> 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  manifest_uri text NOT NULL CHECK (octet_length(manifest_uri) BETWEEN 1 AND 200),
  price_lamports numeric(20, 0) NOT NULL
    CHECK (price_lamports BETWEEN 1 AND 18446744073709551615),
  billing_interval text NOT NULL CHECK (billing_interval = 'week'),
  refund_policy_hash text NOT NULL
    CHECK (refund_policy_hash <> 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  max_protocol_fee_bps smallint NOT NULL
    CHECK (max_protocol_fee_bps BETWEEN 0 AND 1000),
  creator_root_rotation_count numeric(20, 0) NOT NULL
    CHECK (creator_root_rotation_count BETWEEN 0 AND 18446744073709551615),
  creator_sequence numeric(20, 0) NOT NULL
    CHECK (creator_sequence BETWEEN 1 AND 18446744073709551615),
  state_sequence numeric(20, 0) NOT NULL
    CHECK (state_sequence BETWEEN 1 AND 18446744073709551615),
  active boolean NOT NULL,
  created_slot numeric(20, 0) NOT NULL
    CHECK (created_slot BETWEEN 0 AND 18446744073709551615),
  created_at timestamptz NOT NULL,
  updated_slot numeric(20, 0) NOT NULL
    CHECK (updated_slot BETWEEN created_slot AND 18446744073709551615),
  updated_at timestamptz NOT NULL,
  retired_slot numeric(20, 0)
    CHECK (retired_slot IS NULL OR retired_slot BETWEEN created_slot AND 18446744073709551615),
  retired_at timestamptz,
  transaction_signature text NOT NULL,
  transaction_index integer CHECK (transaction_index IS NULL OR transaction_index >= 0),
  log_index integer NOT NULL CHECK (log_index >= 0),
  PRIMARY KEY (network_id, offering_address),
  UNIQUE (network_id, creator_identity_id, offering_nonce),
  FOREIGN KEY (network_id, payment_config_address)
    REFERENCES payment_configs(network_id, payment_config_address) ON DELETE CASCADE,
  FOREIGN KEY (network_id, creator_identity_id)
    REFERENCES identities(network_id, identity_id) ON DELETE CASCADE,
  CHECK (
    (active AND retired_slot IS NULL AND retired_at IS NULL)
    OR (NOT active AND retired_slot IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE INDEX subscription_offerings_by_creator
  ON subscription_offerings(network_id, creator_identity_id, created_slot, offering_address);

CREATE TABLE subscription_offering_splits (
  network_id text NOT NULL,
  offering_address text NOT NULL,
  split_index smallint NOT NULL CHECK (split_index BETWEEN 0 AND 2),
  recipient_identity_id text NOT NULL,
  destination text NOT NULL,
  basis_points smallint NOT NULL CHECK (basis_points BETWEEN 1 AND 10000),
  PRIMARY KEY (network_id, offering_address, split_index),
  UNIQUE (network_id, offering_address, recipient_identity_id),
  UNIQUE (network_id, offering_address, destination),
  FOREIGN KEY (network_id, offering_address)
    REFERENCES subscription_offerings(network_id, offering_address) ON DELETE CASCADE,
  FOREIGN KEY (network_id, recipient_identity_id)
    REFERENCES identities(network_id, identity_id) ON DELETE CASCADE
);

CREATE TABLE payment_receipts (
  network_id text NOT NULL,
  receipt_address text NOT NULL,
  payment_config_address text NOT NULL,
  terms_reference text NOT NULL,
  payer_identity_id text NOT NULL,
  payer_authority text NOT NULL,
  subject_identity_id text NOT NULL,
  primary_recipient_destination text NOT NULL,
  receipt_nonce text NOT NULL
    CHECK (receipt_nonce ~ '^[0-9a-f]{32}$' AND receipt_nonce <> repeat('0', 32)),
  payment_kind text NOT NULL CHECK (payment_kind IN ('woke-tip', 'weekly-subscription')),
  payment_policy_sequence numeric(20, 0) NOT NULL
    CHECK (payment_policy_sequence BETWEEN 1 AND 18446744073709551615),
  terms_state_sequence numeric(20, 0) NOT NULL
    CHECK (terms_state_sequence BETWEEN 0 AND 18446744073709551615),
  terms_manifest_hash text NOT NULL,
  payer_root_rotation_count numeric(20, 0) NOT NULL
    CHECK (payer_root_rotation_count BETWEEN 0 AND 18446744073709551615),
  gross_lamports numeric(20, 0) NOT NULL
    CHECK (gross_lamports BETWEEN 1 AND 18446744073709551615),
  fee_bps smallint NOT NULL CHECK (fee_bps BETWEEN 0 AND 1000),
  fee_destination text NOT NULL,
  fee_lamports numeric(20, 0) NOT NULL
    CHECK (fee_lamports BETWEEN 0 AND 18446744073709551615),
  distributable_lamports numeric(20, 0) NOT NULL
    CHECK (distributable_lamports BETWEEN 1 AND 18446744073709551615),
  refund_policy_hash text NOT NULL,
  entitlement_from_timestamp numeric(19, 0) NOT NULL
    CHECK (entitlement_from_timestamp BETWEEN 0 AND 9223372036854775807),
  entitlement_until_timestamp numeric(19, 0) NOT NULL
    CHECK (entitlement_until_timestamp BETWEEN 0 AND 9223372036854775807),
  paid_at_timestamp numeric(19, 0) NOT NULL
    CHECK (paid_at_timestamp BETWEEN 0 AND 9223372036854775807),
  paid_at_slot numeric(20, 0) NOT NULL
    CHECK (paid_at_slot BETWEEN 0 AND 18446744073709551615),
  recorded_at timestamptz NOT NULL,
  transaction_signature text NOT NULL,
  transaction_index integer CHECK (transaction_index IS NULL OR transaction_index >= 0),
  log_index integer NOT NULL CHECK (log_index >= 0),
  PRIMARY KEY (network_id, receipt_address),
  UNIQUE (network_id, payer_identity_id, receipt_nonce),
  FOREIGN KEY (network_id, payment_config_address)
    REFERENCES payment_configs(network_id, payment_config_address) ON DELETE CASCADE,
  FOREIGN KEY (network_id, payer_identity_id)
    REFERENCES identities(network_id, identity_id) ON DELETE CASCADE,
  FOREIGN KEY (network_id, subject_identity_id)
    REFERENCES identities(network_id, identity_id) ON DELETE CASCADE,
  CHECK (fee_lamports + distributable_lamports = gross_lamports),
  CHECK (
    (payment_kind = 'woke-tip'
      AND terms_state_sequence = 0
      AND entitlement_from_timestamp = 0
      AND entitlement_until_timestamp = 0)
    OR
    (payment_kind = 'weekly-subscription'
      AND terms_state_sequence > 0
      AND terms_manifest_hash <> 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      AND refund_policy_hash <> 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      AND entitlement_from_timestamp >= paid_at_timestamp
      AND entitlement_until_timestamp - entitlement_from_timestamp = 604800)
  )
);

CREATE INDEX payment_receipts_by_payer
  ON payment_receipts(network_id, payer_identity_id, paid_at_slot, receipt_address);
CREATE INDEX payment_receipts_by_subject
  ON payment_receipts(network_id, subject_identity_id, paid_at_slot, receipt_address);

CREATE TABLE payment_receipt_allocations (
  network_id text NOT NULL,
  receipt_address text NOT NULL,
  split_index smallint NOT NULL CHECK (split_index BETWEEN 0 AND 2),
  recipient_identity_id text NOT NULL,
  destination text NOT NULL,
  basis_points smallint NOT NULL CHECK (basis_points BETWEEN 1 AND 10000),
  amount_lamports numeric(20, 0) NOT NULL
    CHECK (amount_lamports BETWEEN 1 AND 18446744073709551615),
  PRIMARY KEY (network_id, receipt_address, split_index),
  UNIQUE (network_id, receipt_address, recipient_identity_id),
  UNIQUE (network_id, receipt_address, destination),
  FOREIGN KEY (network_id, receipt_address)
    REFERENCES payment_receipts(network_id, receipt_address) ON DELETE CASCADE,
  FOREIGN KEY (network_id, recipient_identity_id)
    REFERENCES identities(network_id, identity_id) ON DELETE CASCADE
);

CREATE TABLE subscription_entitlements (
  network_id text NOT NULL,
  entitlement_address text NOT NULL,
  offering_address text NOT NULL,
  beneficiary_identity_id text NOT NULL,
  started_at_timestamp numeric(19, 0) NOT NULL
    CHECK (started_at_timestamp BETWEEN 0 AND 9223372036854775807),
  valid_until_timestamp numeric(19, 0) NOT NULL
    CHECK (valid_until_timestamp > started_at_timestamp),
  settlement_count numeric(20, 0) NOT NULL
    CHECK (settlement_count BETWEEN 1 AND 18446744073709551615),
  last_receipt_address text NOT NULL,
  state_sequence numeric(20, 0) NOT NULL
    CHECK (state_sequence BETWEEN 1 AND 18446744073709551615),
  last_settled_at_slot numeric(20, 0) NOT NULL
    CHECK (last_settled_at_slot BETWEEN 0 AND 18446744073709551615),
  refund_policy_hash text NOT NULL
    CHECK (refund_policy_hash <> 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  recorded_at timestamptz NOT NULL,
  transaction_signature text NOT NULL,
  transaction_index integer CHECK (transaction_index IS NULL OR transaction_index >= 0),
  log_index integer NOT NULL CHECK (log_index >= 0),
  PRIMARY KEY (network_id, entitlement_address),
  UNIQUE (network_id, offering_address, beneficiary_identity_id),
  FOREIGN KEY (network_id, offering_address)
    REFERENCES subscription_offerings(network_id, offering_address) ON DELETE CASCADE,
  FOREIGN KEY (network_id, beneficiary_identity_id)
    REFERENCES identities(network_id, identity_id) ON DELETE CASCADE,
  FOREIGN KEY (network_id, last_receipt_address)
    REFERENCES payment_receipts(network_id, receipt_address) ON DELETE CASCADE
);

CREATE INDEX subscription_entitlements_by_beneficiary
  ON subscription_entitlements(
    network_id,
    beneficiary_identity_id,
    valid_until_timestamp,
    entitlement_address
  );
