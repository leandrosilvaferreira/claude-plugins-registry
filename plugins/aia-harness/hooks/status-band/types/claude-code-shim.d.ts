// Minimal stand-in so `tsc` resolves `claude-code`, which only exists inside the Claude Code engine.
// Not listed as the manifest "types": the engine ships its own declaration.
declare module "claude-code" {
  export interface PluginState {}
  type Hook = (api: any, event: any, next: (event: any) => any) => any;
  type On = {
    (event: string, hook: Hook): { catch: (handler: Hook) => void };
    (event: string, matcher: object, hook: Hook): { catch: (handler: Hook) => void };
  };
  export type Register = (on: On) => void;
  export function atom(key: { plugin: string; key: string }, initial: any): any;
  export function read($: any, atom: any): Promise<any>;
  export function update($: any, atom: any, fn: (state: any) => any): Promise<any>;
}
