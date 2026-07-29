import { strict as assert } from "node:assert";

import { BN, type web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
  assertAnchorError,
  createIdentity,
  type Phase2Context,
} from "./phase2_test_helpers";
import { parsedEvents } from "./governance_test_helpers";

export function registerIdentityDeactivationTests(
  context: Phase2Context,
): void {
  const { config, program } = context;

  describe("identity deactivation", () => {
    it("requires the current root and sequence, rejects substitution and replay, and stays inactive", async () => {
      const owner = await createIdentity(context, 197);
      const other = await createIdentity(context, 217);

      const deactivate = (
        identity: web3.PublicKey,
        rootAuthority: web3.Keypair,
        expectedIdentitySequence: number,
      ): Promise<string> =>
        program.methods
          .deactivateIdentity({
            expectedIdentitySequence: new BN(expectedIdentitySequence),
          })
          .accountsStrict({
            config,
            identity,
            rootAuthority: rootAuthority.publicKey,
          })
          .signers([rootAuthority])
          .rpc();

      await assertAnchorError(
        deactivate(owner.address, other.authority, 0),
        "Unauthorized",
      );
      await assertAnchorError(
        deactivate(owner.address, owner.authority, 1),
        "SequenceMismatch",
      );
      await assertAnchorError(
        deactivate(config, owner.authority, 0),
        "AccountDiscriminatorMismatch",
      );

      const signature = await deactivate(owner.address, owner.authority, 0);

      const state = await program.account.identity.fetch(owner.address);
      assert.equal(state.active, false);
      assert.equal(state.sequence.toNumber(), 1);

      const deactivationEvents = (
        await parsedEvents(context, signature)
      ).filter(({ name }) => name === "identityDeactivated");
      assert.equal(deactivationEvents.length, 1);
      const event = deactivationEvents[0]?.data as
        | Record<string, unknown>
        | undefined;
      assert.ok(event);
      assert.equal(event.eventVersion, 1);
      assert.equal(
        (event.config as web3.PublicKey).toBase58(),
        config.toBase58(),
      );
      assert.equal(
        (event.identity as web3.PublicKey).toBase58(),
        owner.address.toBase58(),
      );
      assert.equal(
        (event.rootAuthority as web3.PublicKey).toBase58(),
        owner.authority.publicKey.toBase58(),
      );
      assert.equal((event.identitySequence as BN).toNumber(), 1);
      assert.ok((event.deactivatedAtSlot as BN).gtn(0));

      await assertAnchorError(
        deactivate(owner.address, owner.authority, 0),
        "SequenceMismatch",
      );
      await assertAnchorError(
        deactivate(owner.address, owner.authority, 1),
        "IdentityInactive",
      );
    });
  });
}
