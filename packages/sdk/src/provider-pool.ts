export interface ProviderEndpoint {
  readonly url: string;
  readonly priority: number;
}

export interface ProviderAttempt {
  readonly url: string;
  readonly startedAt: number;
}

export class ReplaceableProviderPool {
  readonly #endpoints: readonly ProviderEndpoint[];
  #cursor = 0;

  constructor(endpoints: readonly ProviderEndpoint[]) {
    if (endpoints.length === 0) {
      throw new TypeError('At least one provider endpoint is required.');
    }
    this.#endpoints = [...endpoints]
      .map((endpoint) => ({
        ...endpoint,
        url: validateProviderUrl(endpoint.url),
      }))
      .sort((left, right) => left.priority - right.priority);
  }

  async execute<T>(
    operation: (endpoint: ProviderEndpoint, attempt: ProviderAttempt) => Promise<T>,
  ): Promise<T> {
    const failures: Error[] = [];
    for (let offset = 0; offset < this.#endpoints.length; offset += 1) {
      const index = (this.#cursor + offset) % this.#endpoints.length;
      const endpoint = this.#endpoints[index];
      if (endpoint === undefined) {
        throw new RangeError('Provider pool cursor is outside its endpoint set.');
      }
      try {
        const result = await operation(endpoint, {
          url: endpoint.url,
          startedAt: Date.now(),
        });
        this.#cursor = index;
        return result;
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Unknown provider error'));
      }
    }
    throw new AggregateError(failures, 'All configured providers failed.');
  }

  list(): readonly ProviderEndpoint[] {
    return [...this.#endpoints];
  }
}

function validateProviderUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new TypeError('Remote provider endpoints must use HTTPS.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('Provider credentials must not be embedded in URLs.');
  }
  return url.toString();
}
