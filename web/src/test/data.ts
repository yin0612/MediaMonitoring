import type { AsyncState } from '../api/useData';

const states = new Map<string, AsyncState<unknown>>();

export function setDataState<T>(name: string, state: AsyncState<T>) {
  states.set(name, state);
}

export function clearDataStates() {
  states.clear();
}

export function useDataMock<T>(name: string): AsyncState<T> {
  const state = states.get(name);
  if (!state) throw new Error('Missing fixture: ' + name);
  return state as AsyncState<T>;
}
