// redlock@5 ships type declarations at dist/index.d.ts but omits a "types" condition from its
// package.json "exports", so moduleResolution:"Bundler" can't find them. This ambient shim
// mirrors the subset we use (verified against node_modules/redlock/dist/index.d.ts). Drop it if
// redlock fixes its exports map.
declare module 'redlock' {
  export class ExecutionError extends Error {
    constructor(message: string, attempts: ReadonlyArray<Promise<unknown>>);
  }
  export class ResourceLockedError extends Error {
    constructor(message: string);
  }
  export class Lock {
    readonly expiration: number;
    extend(duration: number): Promise<Lock>;
    release(): Promise<unknown>;
  }
  export interface Settings {
    readonly driftFactor: number;
    readonly retryCount: number;
    readonly retryDelay: number;
    readonly retryJitter: number;
    readonly automaticExtensionThreshold: number;
  }
  export default class Redlock {
    constructor(clients: Iterable<unknown>, settings?: Partial<Settings>);
    acquire(resources: string[], duration: number, settings?: Partial<Settings>): Promise<Lock>;
    release(lock: Lock, settings?: Partial<Settings>): Promise<unknown>;
    extend(existing: Lock, duration: number, settings?: Partial<Settings>): Promise<Lock>;
    using<T>(resources: string[], duration: number, routine: (signal: AbortSignal) => Promise<T>): Promise<T>;
    using<T>(
      resources: string[],
      duration: number,
      settings: Partial<Settings>,
      routine: (signal: AbortSignal) => Promise<T>,
    ): Promise<T>;
  }
}
