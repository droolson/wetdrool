const DATABASE_NAME = "wetdrool-wokenet-alpha";
const DATABASE_VERSION = 1;
const RECORD_STORE = "records";
const SETTING_STORE = "settings";

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

export async function openVault() {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(RECORD_STORE)) {
      database.createObjectStore(RECORD_STORE, { keyPath: "cid" });
    }
    if (!database.objectStoreNames.contains(SETTING_STORE)) {
      database.createObjectStore(SETTING_STORE, { keyPath: "key" });
    }
  });
  return requestToPromise(request);
}

export async function listRecords(database) {
  const transaction = database.transaction(RECORD_STORE, "readonly");
  const request = transaction.objectStore(RECORD_STORE).getAll();
  const result = await requestToPromise(request);
  await transactionToPromise(transaction);
  return result.sort((left, right) =>
    String(right.manifest?.createdAt || "").localeCompare(
      String(left.manifest?.createdAt || ""),
    ),
  );
}

export async function putRecord(database, record) {
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).put(record);
  await transactionToPromise(transaction);
}

export async function putRecords(database, records) {
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  const store = transaction.objectStore(RECORD_STORE);
  for (const record of records) {
    store.put(record);
  }
  await transactionToPromise(transaction);
}

export async function getSetting(database, key) {
  const transaction = database.transaction(SETTING_STORE, "readonly");
  const result = await requestToPromise(transaction.objectStore(SETTING_STORE).get(key));
  await transactionToPromise(transaction);
  return result?.value ?? null;
}

export async function putSetting(database, key, value) {
  const transaction = database.transaction(SETTING_STORE, "readwrite");
  transaction.objectStore(SETTING_STORE).put({ key, value });
  await transactionToPromise(transaction);
}

export async function clearVault(database) {
  const transaction = database.transaction([RECORD_STORE, SETTING_STORE], "readwrite");
  transaction.objectStore(RECORD_STORE).clear();
  transaction.objectStore(SETTING_STORE).clear();
  await transactionToPromise(transaction);
}
