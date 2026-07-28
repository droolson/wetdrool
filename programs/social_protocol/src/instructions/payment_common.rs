use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::{
    constants::MAX_ONCHAIN_PAYMENT_SPLITS,
    errors::SocialProtocolError,
    state::{Identity, PaymentSplit},
    validation::{validate_payment_identity, validate_payment_split_shape},
};

#[allow(clippy::too_many_arguments)]
pub fn collect_subscription_splits<'info>(
    config_key: Pubkey,
    creator_identity: &Account<'_, Identity>,
    creator_destination: Pubkey,
    creator_basis_points: u16,
    additional_basis_points: &[u16],
    recipient_identity_0: Option<&Account<'info, Identity>>,
    recipient_destination_0: Option<&SystemAccount<'info>>,
    recipient_identity_1: Option<&Account<'info, Identity>>,
    recipient_destination_1: Option<&SystemAccount<'info>>,
) -> Result<Vec<PaymentSplit>> {
    require!(
        additional_basis_points.len() < MAX_ONCHAIN_PAYMENT_SPLITS,
        SocialProtocolError::InvalidPaymentSplits
    );
    validate_payment_identity(
        creator_identity.key(),
        creator_identity,
        config_key,
        creator_destination,
    )?;
    let identities = [recipient_identity_0, recipient_identity_1];
    let destinations = [recipient_destination_0, recipient_destination_1];
    let mut splits = Vec::with_capacity(additional_basis_points.len() + 1);
    splits.push(PaymentSplit {
        recipient_identity: creator_identity.key(),
        destination: creator_destination,
        basis_points: creator_basis_points,
    });
    for index in 0..(MAX_ONCHAIN_PAYMENT_SPLITS - 1) {
        match (
            additional_basis_points.get(index),
            identities[index],
            destinations[index],
        ) {
            (Some(basis_points), Some(identity), Some(destination)) => {
                validate_payment_identity(identity.key(), identity, config_key, destination.key())?;
                splits.push(PaymentSplit {
                    recipient_identity: identity.key(),
                    destination: destination.key(),
                    basis_points: *basis_points,
                });
            }
            (None, None, None) => {}
            _ => return err!(SocialProtocolError::PaymentRecipientSubstitution),
        }
    }
    splits.sort_by_key(|split| split.recipient_identity.to_bytes());
    validate_payment_split_shape(&splits)?;
    Ok(splits)
}

#[allow(clippy::too_many_arguments)]
pub fn collect_offering_payment_splits<'info>(
    config_key: Pubkey,
    expected_splits: &[PaymentSplit],
    creator_identity: &Account<'_, Identity>,
    creator_destination: Pubkey,
    recipient_identity_0: Option<&Account<'info, Identity>>,
    recipient_destination_0: Option<&SystemAccount<'info>>,
    recipient_identity_1: Option<&Account<'info, Identity>>,
    recipient_destination_1: Option<&SystemAccount<'info>>,
) -> Result<Vec<PaymentSplit>> {
    let creator_basis_points = expected_splits
        .iter()
        .find(|split| {
            split.recipient_identity == creator_identity.key()
                && split.destination == creator_destination
        })
        .map(|split| split.basis_points)
        .ok_or_else(|| error!(SocialProtocolError::PaymentRecipientSubstitution))?;
    let identity_options = [recipient_identity_0, recipient_identity_1];
    let destination_options = [recipient_destination_0, recipient_destination_1];
    let mut additional_basis_points = Vec::new();
    for index in 0..(MAX_ONCHAIN_PAYMENT_SPLITS - 1) {
        match (identity_options[index], destination_options[index]) {
            (Some(identity), Some(destination)) => {
                let basis_points = expected_splits
                    .iter()
                    .find(|split| {
                        split.recipient_identity == identity.key()
                            && split.destination == destination.key()
                    })
                    .map(|split| split.basis_points)
                    .ok_or_else(|| error!(SocialProtocolError::PaymentRecipientSubstitution))?;
                additional_basis_points.push(basis_points);
            }
            (None, None) => {}
            _ => return err!(SocialProtocolError::PaymentRecipientSubstitution),
        }
    }
    let actual_splits = collect_subscription_splits(
        config_key,
        creator_identity,
        creator_destination,
        creator_basis_points,
        &additional_basis_points,
        recipient_identity_0,
        recipient_destination_0,
        recipient_identity_1,
        recipient_destination_1,
    )?;
    require!(
        actual_splits == expected_splits,
        SocialProtocolError::PaymentRecipientSubstitution
    );
    Ok(actual_splits)
}

pub fn transfer_lamports<'info>(
    payer_authority: &Signer<'info>,
    destination: &SystemAccount<'info>,
    system_program: &Program<'info, System>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new(
            system_program.to_account_info(),
            Transfer {
                from: payer_authority.to_account_info(),
                to: destination.to_account_info(),
            },
        ),
        lamports,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn transfer_payment_allocations<'info>(
    payer_authority: &Signer<'info>,
    fee_destination: &SystemAccount<'info>,
    creator_destination: &SystemAccount<'info>,
    recipient_destination_0: Option<&SystemAccount<'info>>,
    recipient_destination_1: Option<&SystemAccount<'info>>,
    system_program: &Program<'info, System>,
    fee_lamports: u64,
    splits: &[PaymentSplit],
    recipient_amounts: &[u64],
) -> Result<()> {
    transfer_lamports(
        payer_authority,
        fee_destination,
        system_program,
        fee_lamports,
    )?;
    require_eq!(
        splits.len(),
        recipient_amounts.len(),
        SocialProtocolError::PaymentConservationInvariant
    );
    let destinations = [
        Some(creator_destination),
        recipient_destination_0,
        recipient_destination_1,
    ];
    for (split, amount) in splits.iter().zip(recipient_amounts) {
        let destination = destinations
            .iter()
            .flatten()
            .find(|destination| destination.key() == split.destination)
            .ok_or_else(|| error!(SocialProtocolError::PaymentRecipientSubstitution))?;
        transfer_lamports(payer_authority, destination, system_program, *amount)?;
    }
    Ok(())
}
