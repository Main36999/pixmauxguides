// Must FAIL `tsc --noEmit`, proving the checker really checks: a type error
// (TS2322) and non-erasable syntax rejected by erasableSyntaxOnly.
export const count: number = "not a number";

export enum Level {
  Error,
}
