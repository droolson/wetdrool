import {
  EXPORT_SCHEMA,
  MAX_IMPORT_BYTES,
  MAX_SIGNAL_CHARACTERS,
  base64ToBytes,
  buildVaultUnlockMessage,
  bytesToBase64,
  createUnsignedRecord,
  decodeBase58,
  decryptRecord,
  deriveVaultKey,
  makeSignedRecord,
  openJson,
  sealJson,
  shortIdentity,
  signingBytesForManifest,
  utf8,
  verifyRecord,
  verifyWalletSignature,
} from "./protocol.js";
import {
  getSetting,
  listRecords,
  openVault,
  putRecord,
  putRecords,
  putSetting,
} from "./vault.js";

const DISCOVERY_ITEMS = [
  {
    id: "pride-femboy-studio",
    mode: "pride",
    category: "femboy",
    title: "Femboy studio signal",
    creator: "@neonangel",
    provenance: 1,
    recency: 0.96,
    novelty: 0.92,
    engagement: 0.61,
    colors: ["rgba(20, 216, 255, .82)", "rgba(194, 49, 239, .68)"],
    position: ["30%", "22%"],
  },
  {
    id: "straight-amateur",
    mode: "straight",
    category: "amateur",
    title: "After-hours creator drop",
    creator: "@nightshift",
    provenance: 1,
    recency: 0.91,
    novelty: 0.72,
    engagement: 0.74,
    colors: ["rgba(255, 155, 82, .75)", "rgba(229, 47, 130, .64)"],
    position: ["62%", "24%"],
  },
  {
    id: "pride-trans-creator",
    mode: "pride",
    category: "trans creator",
    title: "Independent creator premiere",
    creator: "@violetwave",
    provenance: 1,
    recency: 0.84,
    novelty: 0.98,
    engagement: 0.53,
    colors: ["rgba(113, 83, 255, .82)", "rgba(255, 74, 192, .66)"],
    position: ["44%", "28%"],
  },
  {
    id: "straight-couples",
    mode: "straight",
    category: "couples",
    title: "Creator-owned couples set",
    creator: "@afterglow",
    provenance: 1,
    recency: 0.78,
    novelty: 0.7,
    engagement: 0.68,
    colors: ["rgba(255, 182, 91, .78)", "rgba(105, 82, 250, .62)"],
    position: ["23%", "41%"],
  },
  {
    id: "pride-queer-couples",
    mode: "pride",
    category: "queer couples",
    title: "Queer creator collaboration",
    creator: "@doublevision",
    provenance: 1,
    recency: 0.72,
    novelty: 0.89,
    engagement: 0.58,
    colors: ["rgba(12, 205, 255, .74)", "rgba(255, 167, 70, .6)"],
    position: ["66%", "18%"],
  },
  {
    id: "straight-cosplay",
    mode: "straight",
    category: "cosplay",
    title: "Midnight cosplay set",
    creator: "@softfocus",
    provenance: 1,
    recency: 0.69,
    novelty: 0.87,
    engagement: 0.49,
    colors: ["rgba(66, 143, 255, .8)", "rgba(245, 62, 188, .61)"],
    position: ["38%", "38%"],
  },
  {
    id: "pride-audio",
    mode: "pride",
    category: "audio",
    title: "Private audio premiere",
    creator: "@lowfrequency",
    provenance: 1,
    recency: 0.63,
    novelty: 0.81,
    engagement: 0.44,
    colors: ["rgba(142, 76, 255, .78)", "rgba(22, 215, 204, .64)"],
    position: ["52%", "16%"],
  },
  {
    id: "straight-solo",
    mode: "straight",
    category: "solo creator",
    title: "Direct-from-creator signal",
    creator: "@daybreak",
    provenance: 1,
    recency: 0.58,
    novelty: 0.76,
    engagement: 0.51,
    colors: ["rgba(255, 116, 83, .76)", "rgba(34, 177, 255, .58)"],
    position: ["34%", "32%"],
  },
];

const state = {
  database: null,
  provider: null,
  publicKey: null,
  vaultKey: null,
  mode: "all",
};

const elements = {
  gateView: document.querySelector("#gate-view"),
  nodeView: document.querySelector("#node-view"),
  connect: document.querySelector("#connect-wallet"),
  disconnect: document.querySelector("#disconnect-wallet"),
  walletStatus: document.querySelector("#wallet-status"),
  walletShort: document.querySelector("#wallet-short"),
  signalForm: document.querySelector("#signal-form"),
  signalBody: document.querySelector("#signal-body"),
  characterCount: document.querySelector("#character-count"),
  bundleList: document.querySelector("#bundle-list"),
  vaultCount: document.querySelector("#vault-count"),
  exportNode: document.querySelector("#export-node"),
  importNode: document.querySelector("#import-node"),
  transferStatus: document.querySelector("#transfer-status"),
  walletHelp: document.querySelector("#wallet-help"),
  showWalletHelp: document.querySelector("#show-wallet-help"),
  closeWalletHelp: document.querySelector("#close-wallet-help"),
  closeWalletHelpButton: document.querySelector("#close-wallet-help-button"),
  retryWallet: document.querySelector("#retry-wallet"),
  toast: document.querySelector("#toast"),
  discoveryFeed: document.querySelector("#discovery-feed"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  profileForm: document.querySelector("#profile-form"),
  displayName: document.querySelector("#display-name"),
  pronouns: document.querySelector("#pronouns"),
  profileStatus: document.querySelector("#profile-status"),
  wetTokenStatus: document.querySelector("#wet-token-status"),
};

function setWalletStatus(message, kind) {
  elements.walletStatus.textContent = message;
  elements.walletStatus.classList.remove("error", "success");
  if (kind) {
    elements.walletStatus.classList.add(kind);
  }
}

function setTransferStatus(message, kind) {
  elements.transferStatus.textContent = message;
  elements.transferStatus.classList.remove("error", "success");
  if (kind) {
    elements.transferStatus.classList.add(kind);
  }
}

let toastTimer = null;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  globalThis.clearTimeout(toastTimer);
  toastTimer = globalThis.setTimeout(() => {
    elements.toast.hidden = true;
  }, 4200);
}

function getWalletProvider() {
  const candidates = [
    globalThis.phantom?.solana,
    globalThis.backpack,
    globalThis.solflare,
    globalThis.solana,
  ];
  const unique = new Set();
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate.connect === "function" &&
      typeof candidate.signMessage === "function" &&
      !unique.has(candidate)
    ) {
      unique.add(candidate);
      return candidate;
    }
  }
  return null;
}

function publicKeyFromConnection(provider, response) {
  const key = response?.publicKey || provider.publicKey;
  if (!key) {
    throw new Error("The wallet did not return a public key.");
  }
  const value = typeof key === "string" ? key : key.toString();
  if (decodeBase58(value).length !== 32) {
    throw new Error("The wallet returned an invalid Solana public key.");
  }
  return value;
}

function signatureBytes(result) {
  const candidate = result?.signature ?? result;
  if (candidate instanceof Uint8Array) {
    return candidate;
  }
  if (Array.isArray(candidate)) {
    return new Uint8Array(candidate);
  }
  if (candidate?.data && Array.isArray(candidate.data)) {
    return new Uint8Array(candidate.data);
  }
  if (typeof candidate === "string") {
    try {
      const decoded = decodeBase58(candidate);
      if (decoded.length === 64) {
        return decoded;
      }
    } catch {
      const decoded = base64ToBytes(candidate);
      if (decoded.length === 64) {
        return decoded;
      }
    }
  }
  throw new Error("The wallet returned an unsupported signature.");
}

async function requestSignature(provider, messageBytes) {
  const result = await provider.signMessage(messageBytes, "utf8");
  const signature = signatureBytes(result);
  if (signature.length !== 64) {
    throw new Error("The wallet signature had the wrong length.");
  }
  return signature;
}

async function connectWallet() {
  if (state.vaultKey) {
    return;
  }
  const provider = getWalletProvider();
  if (!provider) {
    setWalletStatus("No compatible wallet detected. Open the Seeker / mobile guide.", "error");
    elements.walletHelp.hidden = false;
    return;
  }

  elements.connect.disabled = true;
  setWalletStatus("Connecting to the wallet…");
  try {
    const response = await provider.connect();
    const publicKey = publicKeyFromConnection(provider, response);
    const message = buildVaultUnlockMessage(publicKey, globalThis.location.origin);
    setWalletStatus("Review the local-only text signature in your wallet.");
    const signature = await requestSignature(provider, utf8(message));
    const verified = await verifyWalletSignature(utf8(message), signature, publicKey);
    if (!verified) {
      throw new Error("Local signature verification failed.");
    }

    const vaultKey = await deriveVaultKey(
      signature,
      publicKey,
      globalThis.location.origin,
    );
    state.provider = provider;
    state.publicKey = publicKey;
    state.vaultKey = vaultKey;
    elements.walletShort.textContent = shortIdentity(publicKey);
    elements.gateView.hidden = true;
    elements.nodeView.hidden = false;
    setWalletStatus("Local wallet proof verified.", "success");
    await loadLocalPreferences();
    await renderRecords();
    renderDiscovery();
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
    showToast("Local node unlocked. No transaction was requested.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The wallet request did not complete.";
    setWalletStatus(message, "error");
  } finally {
    elements.connect.disabled = false;
  }
}

function lockNode() {
  state.provider = null;
  state.publicKey = null;
  state.vaultKey = null;
  elements.displayName.value = "";
  elements.pronouns.value = "";
  elements.nodeView.hidden = true;
  elements.gateView.hidden = false;
  setWalletStatus("Node locked. Reconnect to derive the local key again.");
  globalThis.scrollTo({ top: 0, behavior: "smooth" });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (typeof text === "string") {
    element.textContent = text;
  }
  return element;
}

async function renderRecords() {
  const records = await listRecords(state.database);
  elements.vaultCount.textContent =
    records.length + (records.length === 1 ? " object" : " objects");
  elements.bundleList.replaceChildren();

  if (records.length === 0) {
    const empty = createElement("div", "empty-state");
    empty.append(
      createElement("span", null, "∅"),
      createElement("p", null, "No local objects yet."),
    );
    elements.bundleList.append(empty);
    return;
  }

  for (const record of records) {
    const verified = await verifyRecord(record);
    let body = "Encrypted object from another wallet.";
    if (verified && record.authorPublicKey === state.publicKey) {
      try {
        const payload = await decryptRecord(record, state.vaultKey);
        body = payload.body;
      } catch {
        body = "Verified ciphertext. This node key cannot decrypt it.";
      }
    } else if (!verified) {
      body = "Rejected: local verification failed.";
    }

    const card = createElement("article", "bundle-card");
    const header = createElement("header");
    header.append(
      createElement("span", null, verified ? "verified signed CID" : "verification failed"),
      createElement(
        "time",
        null,
        new Date(record.manifest?.createdAt || 0).toLocaleString(),
      ),
    );
    card.append(
      header,
      createElement("p", null, body),
      createElement("code", null, record.cid),
    );
    elements.bundleList.append(card);
  }
}

async function createSignal(event) {
  event.preventDefault();
  if (!state.provider || !state.vaultKey || !state.publicKey) {
    showToast("Unlock the local node first.");
    return;
  }

  const submit = elements.signalForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const unsignedRecord = await createUnsignedRecord(
      elements.signalBody.value,
      state.publicKey,
      state.vaultKey,
    );
    const message = signingBytesForManifest(unsignedRecord.manifest);
    const signature = await requestSignature(state.provider, message);
    const verified = await verifyWalletSignature(message, signature, state.publicKey);
    if (!verified) {
      throw new Error("Manifest signature verification failed.");
    }
    const record = makeSignedRecord(unsignedRecord, state.publicKey, signature);
    if (!(await verifyRecord(record))) {
      throw new Error("The completed record did not verify.");
    }
    await putRecord(state.database, record);
    elements.signalBody.value = "";
    elements.characterCount.textContent = "0 / " + MAX_SIGNAL_CHARACTERS;
    await renderRecords();
    showToast("Encrypted locally and sealed as " + shortIdentity(record.cid) + ".");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not seal the local signal.");
  } finally {
    submit.disabled = false;
  }
}

async function exportNode() {
  const records = await listRecords(state.database);
  const exportObject = {
    schema: EXPORT_SCHEMA,
    app: "wetdrool",
    exportedAt: new Date().toISOString(),
    privacy: "encrypted-records-signed-manifests",
    publication: "none",
    records,
  };
  const blob = new Blob([JSON.stringify(exportObject, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wetdrool-local-node-" + new Date().toISOString().slice(0, 10) + ".json";
  anchor.click();
  URL.revokeObjectURL(url);
  setTransferStatus(
    records.length + (records.length === 1 ? " verified record exported." : " verified records exported."),
    "success",
  );
}

async function importNode(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    setTransferStatus("Import rejected: the bundle exceeds 1 MiB.", "error");
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    if (
      parsed?.schema !== EXPORT_SCHEMA ||
      !Array.isArray(parsed.records) ||
      parsed.records.length > 256
    ) {
      throw new Error("Unsupported or oversized node export.");
    }
    const verifiedRecords = [];
    for (const record of parsed.records) {
      if (!(await verifyRecord(record))) {
        throw new Error("Import rejected: a CID or wallet signature failed verification.");
      }
      verifiedRecords.push(record);
    }
    await putRecords(state.database, verifiedRecords);
    await renderRecords();
    setTransferStatus(
      verifiedRecords.length +
        (verifiedRecords.length === 1
          ? " signed record imported."
          : " signed records imported."),
      "success",
    );
  } catch (error) {
    setTransferStatus(
      error instanceof Error ? error.message : "The import could not be verified.",
      "error",
    );
  }
}

function scoreDiscoveryItem(item, mode) {
  const modeMatch = mode === "all" ? 0.5 : item.mode === mode ? 1 : 0;
  const boundedEngagement = Math.min(item.engagement, 0.75);
  return (
    item.provenance * 0.35 +
    item.recency * 0.2 +
    item.novelty * 0.2 +
    boundedEngagement * 0.1 +
    modeMatch * 0.15
  );
}

function renderDiscovery() {
  const visible = DISCOVERY_ITEMS.filter(
    (item) => state.mode === "all" || item.mode === state.mode,
  )
    .map((item) => ({ ...item, score: scoreDiscoveryItem(item, state.mode) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  elements.discoveryFeed.replaceChildren();
  for (const item of visible) {
    const card = createElement("article", "feed-card");
    const visual = createElement("div", "feed-card-visual");
    visual.style.setProperty("--tone-a", item.colors[0]);
    visual.style.setProperty("--tone-b", item.colors[1]);
    visual.style.setProperty("--x", item.position[0]);
    visual.style.setProperty("--y", item.position[1]);

    const content = createElement("div", "feed-card-content");
    const meta = createElement("div", "feed-card-meta");
    meta.append(
      createElement("span", null, item.category),
      createElement("span", null, "provenance ✓"),
    );
    content.append(
      meta,
      createElement("h3", null, item.title),
      createElement("p", null, item.creator + " · synthetic protocol fixture"),
    );
    card.append(visual, content);
    elements.discoveryFeed.append(card);
  }
}

async function changeMode(event) {
  const mode = event.currentTarget.dataset.mode;
  if (!["all", "straight", "pride"].includes(mode)) {
    return;
  }
  state.mode = mode;
  for (const button of elements.modeButtons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (state.publicKey) {
    await putSetting(state.database, "discovery-mode:" + state.publicKey, mode);
  }
  renderDiscovery();
}

async function saveProfile(event) {
  event.preventDefault();
  if (!state.vaultKey || !state.publicKey) {
    return;
  }
  const profile = {
    schema: "wetdrool.local-profile/1",
    displayName: elements.displayName.value.trim().normalize("NFC"),
    pronouns: elements.pronouns.value.trim().normalize("NFC"),
    updatedAt: new Date().toISOString(),
  };
  if (profile.displayName.length > 40 || profile.pronouns.length > 40) {
    elements.profileStatus.textContent = "Name and pronouns must be 40 characters or fewer.";
    return;
  }
  const aad = {
    schema: "wetdrool.local-profile-aad/1",
    wallet: state.publicKey,
  };
  const sealed = await sealJson(profile, state.vaultKey, aad);
  await putSetting(state.database, "profile:" + state.publicKey, { aad, sealed });
  elements.profileStatus.textContent = "Encrypted and stored only in this browser.";
  showToast("Chosen identity saved locally.");
}

async function loadLocalPreferences() {
  const storedMode = await getSetting(
    state.database,
    "discovery-mode:" + state.publicKey,
  );
  state.mode = ["all", "straight", "pride"].includes(storedMode) ? storedMode : "all";
  for (const button of elements.modeButtons) {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  const storedProfile = await getSetting(state.database, "profile:" + state.publicKey);
  if (storedProfile?.aad && storedProfile?.sealed) {
    try {
      const profile = await openJson(storedProfile.sealed, state.vaultKey, storedProfile.aad);
      elements.displayName.value = profile.displayName || "";
      elements.pronouns.value = profile.pronouns || "";
      elements.profileStatus.textContent = "Decrypted for this tab only.";
    } catch {
      elements.profileStatus.textContent = "Stored profile could not be decrypted.";
    }
  } else {
    elements.profileStatus.textContent = "Stored only after you save.";
  }
}

function openWalletHelp() {
  elements.walletHelp.hidden = false;
  elements.closeWalletHelpButton.focus();
}

function closeWalletHelp() {
  elements.walletHelp.hidden = true;
  elements.showWalletHelp.focus();
}

async function initialize() {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle || !globalThis.indexedDB) {
    setWalletStatus(
      "This alpha requires a secure browser context with WebCrypto and IndexedDB.",
      "error",
    );
    elements.connect.disabled = true;
    return;
  }

  state.database = await openVault();
  const tokenConfig = globalThis.WETDROOL_ALPHA;
  elements.wetTokenStatus.textContent = tokenConfig?.WET_CA
    ? shortIdentity(tokenConfig.WET_CA)
    : "Mint pending";
  renderDiscovery();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // Offline caching is optional; cryptographic operations remain local.
    });
  }
}

elements.connect.addEventListener("click", connectWallet);
elements.disconnect.addEventListener("click", lockNode);
elements.signalForm.addEventListener("submit", createSignal);
elements.signalBody.addEventListener("input", () => {
  elements.characterCount.textContent =
    elements.signalBody.value.length + " / " + MAX_SIGNAL_CHARACTERS;
});
elements.exportNode.addEventListener("click", exportNode);
elements.importNode.addEventListener("change", importNode);
elements.profileForm.addEventListener("submit", saveProfile);
for (const button of elements.modeButtons) {
  button.addEventListener("click", changeMode);
}
elements.showWalletHelp.addEventListener("click", openWalletHelp);
elements.closeWalletHelp.addEventListener("click", closeWalletHelp);
elements.closeWalletHelpButton.addEventListener("click", closeWalletHelp);
elements.retryWallet.addEventListener("click", () => {
  elements.walletHelp.hidden = true;
  connectWallet();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.walletHelp.hidden) {
    closeWalletHelp();
  }
});

initialize().catch((error) => {
  setWalletStatus(
    error instanceof Error ? error.message : "The local node could not initialize.",
    "error",
  );
});
