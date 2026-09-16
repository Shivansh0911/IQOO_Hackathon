// RULE A fixture: platform-agnostic code. Must lint clean, forever.
export type Verdict = 'Pass' | 'Fail' | 'Blocked';

export function isTerminal(verdict: Verdict): boolean {
  return verdict === 'Pass' || verdict === 'Fail' || verdict === 'Blocked';
}
