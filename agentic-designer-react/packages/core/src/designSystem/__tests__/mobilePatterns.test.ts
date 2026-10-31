import { describe, expect, it } from 'vitest';
import { MobileDesignPatternLibrary, MobileDesignPatternPresets } from '../MobileDesignPatterns';
import { DeviceDesignRuleLibrary } from '../DeviceDesignRules';
import { AllDevicePlatform } from '../DevicePreset';

describe('MobileDesignPatternLibrary.pattern — MobileDesignPatterns.swift 230-292', () => {
  it('routes prompts to the Swift patterns, in order', () => {
    expect(MobileDesignPatternLibrary.pattern('a crypto wallet').category).toBe('finance');
    expect(MobileDesignPatternLibrary.pattern('gym workout tracker').category).toBe('fitness');
    expect(MobileDesignPatternLibrary.pattern('self care therapy').category).toBe('mentalHealth');
    expect(MobileDesignPatternLibrary.pattern('flight and hotel trips').category).toBe('travel');
    expect(MobileDesignPatternLibrary.pattern('an ai assistant').category).toBe('aiChat');
    expect(MobileDesignPatternLibrary.pattern('a notes app').category).toBe('generic');
    expect(MobileDesignPatternLibrary.pattern('בנק וארנק').category).toBe('finance');
  });

  it('keeps each pattern payload verbatim', () => {
    expect(MobileDesignPatternPresets.finance.commonComponents).toEqual([
      'balanceCard', 'metricCard', 'transactionList', 'quickActionButton', 'chartCard', 'segmentedControl',
    ]);
    expect(MobileDesignPatternPresets.generic.layoutPrinciples[0]).toBe("Infer the product's real objects from the prompt.");
    expect(MobileDesignPatternPresets.fitness.avoid.length).toBe(4);
  });
});

describe('DeviceDesignRuleLibrary.rules — DeviceDesignRules.swift 13-119', () => {
  it('covers every DevicePlatform', () => {
    for (const platform of AllDevicePlatform) {
      expect(DeviceDesignRuleLibrary.rules(platform).platform).toBe(platform);
    }
    expect(DeviceDesignRuleLibrary.rules('iPhone').rules.length).toBe(5);
    expect(DeviceDesignRuleLibrary.rules('iPad').recommendedComponents).toEqual(['sidebar', 'splitView', 'cardGrid', 'detailPanel', 'toolbar']);
    expect(DeviceDesignRuleLibrary.rules('appleWatch').avoid.length).toBe(4);
    expect(DeviceDesignRuleLibrary.rules('mac').rules[0]).toBe('Use desktop productivity layouts.');
    expect(DeviceDesignRuleLibrary.rules('custom').recommendedComponents).toEqual([]);
  });
});
