// apps/web/src/stores/logicStore.ts
//
// Shared reactive instances of LogicViewModel and LogicSimulator attached to project hosts.

import { useState, useEffect } from 'react';
import { LogicViewModel, LogicSimulator } from '@agentic/core';
import { designHostForLogic, simulatorDesignHost } from './projectHost';

export const logicViewModel = new LogicViewModel();
logicViewModel.attach(designHostForLogic);

export const logicSimulator = new LogicSimulator();
logicSimulator.logicViewModel = logicViewModel;
logicSimulator.designViewModel = simulatorDesignHost;

export function useLogicViewModel(): LogicViewModel {
  const [, setTick] = useState(0);
  useEffect(() => {
    return logicViewModel.subscribe(() => setTick((t) => t + 1));
  }, []);
  return logicViewModel;
}

export function useLogicSimulator(): LogicSimulator {
  const [, setTick] = useState(0);
  useEffect(() => {
    return logicSimulator.subscribe(() => setTick((t) => t + 1));
  }, []);
  return logicSimulator;
}
