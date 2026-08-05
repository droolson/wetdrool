// WetDrool product FE/BE swarm — optional workflow launcher.
// Prefer the 15m scheduler orchestrator; this script is a manual/heavy fanout helper.

let meta = #{
    name: "wetdrool-product-swarm",
    description: "Parallel FE/BE specialists for WetDrool apps/web product surfaces",
};

// args: optional #{ slots: ["api","discovery","market","rooms","auth","live"] }

let default_slots = ["api", "discovery", "market", "rooms", "auth", "live"];
let slots = if type_of(args) == "map" && args.contains("slots") { args.slots } else { default_slots };

let prompts = #{
    "api": "WetDrool monorepo: improve apps/web product APIs under app/api/v1 and lib/product-*.ts only. Strict JSON, pagination, honest flags, tests. No CUMDUMP restore. Commit if clean.",
    "discovery": "WetDrool monorepo: improve shorts/hub/feeds discovery FE+BE (short-feed, hub-catalog, shorts API). Synthetic labels, ranking, a11y. Scope only those paths. Commit if clean.",
    "market": "WetDrool monorepo: marketplace + x402 FE+BE only (marketplace*, x402, market API). Fail-closed payments, age gate, tests. No fake revenue. Commit if clean.",
    "rooms": "WetDrool monorepo: E2EE rooms FE+BE only (room-store, e2ee-*, rooms routes/components). Pagination, durability honesty, a11y. Commit if clean.",
    "auth": "WetDrool monorepo: auth/settings passkey surfaces only (auth-service-config, auth status API, signin/onboarding/settings). Honest readiness. Commit if clean.",
    "live": "WetDrool monorepo: live/fame/creators FE+BE only. Wire APIs, pagination, empty/error states. Commit if clean.",
};

// Fan out specialists in parallel (one agent call per selected slot).
let results = parallel(
    slots.map(|s| #{
        name: s,
        prompt: prompts[s] + " Workspace: wetdrool-web monorepo. $DROOL does not exist. Return files changed + test results.",
        role: "general-purpose",
    })
);

print("SWARM_DONE");
print(results);
