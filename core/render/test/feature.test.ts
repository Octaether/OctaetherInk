import type { PropertyValue } from '@octaether/core-format';
import type { ModuleDefinition } from '@octaether/core-sdk';
import { describe, expect, it } from 'vitest';
import { type HostService, Registry } from '../src';

/** A module with one feature that needs another module, and a template and an extension of that feature. */
function setup(): { registry: Registry; settingMap: Map<string, PropertyValue> } {
	const settingMap = new Map<string, PropertyValue>();
	const registry = new Registry();
	const board: ModuleDefinition = { kind: 'Module', name: 'Board', publisher: 'Test', version: '1', title: 'Board', explain: '', blockTypeList: [] };
	const chem: ModuleDefinition = {
		kind: 'Module',
		name: 'Chem',
		publisher: 'Test',
		version: '1',
		title: 'Chemistry',
		explain: '',
		featureList: [{ id: 'Chem.Board', title: 'Drawing on Boards', explain: '', default: true, use: ['Board'], settingList: [{ id: 'Chem.BoardGrid', title: 'Grid', type: 'Toggle', default: false, explain: '' }] }],
		blockTypeList: [
			{
				name: 'Chem',
				content: 'Raw',
				render: { mount() {} },
				templateList: [
					{ title: 'Structure', source: 'Chem:' },
					{ title: 'Mechanism', source: 'Board:', feature: 'Chem.Board' },
				],
			},
		],
		activate(host) {
			host.registerExtension('Board.Editor', { open() {} }, 'Chem.Board');
		},
	};
	registry.add(board);
	registry.add(chem);
	const service: HostService = {
		registerCommand: () => () => {},
		registerTheme: () => () => {},
		setting: (id) => settingMap.get(id),
		theme: () => ({ name: 'Light', mode: 'Light', token: {} }),
		applyTheme: () => {},
		themeList: () => [],
	};
	registry.attach(service);
	return { registry, settingMap };
}

describe('features: parts of a module with their own switch and needs', () => {
	it('is on by default while every module it needs is on', () => {
		const { registry } = setup();
		expect(registry.isFeatureActive('Chem.Board')).toBe(true);
		expect(registry.extension('Board.Editor')).toBeDefined();
		expect(registry.templateList().map((template) => template.title)).toEqual(['Structure', 'Mechanism']);
	});

	it('goes off with the module it needs, and its extension and templates with it', () => {
		const { registry } = setup();
		registry.setEnabled('Board', false);
		expect(registry.missingFor('Chem.Board')).toEqual(['Board']);
		expect(registry.isFeatureActive('Chem.Board')).toBe(false);
		expect(registry.extension('Board.Editor')).toBeUndefined();
		expect(registry.templateList().map((template) => template.title)).toEqual(['Structure']);
		registry.setEnabled('Board', true);
		expect(registry.extension('Board.Editor')).toBeDefined();
	});

	it('has its own switch (a setting with its id) and its own settings', () => {
		const { registry, settingMap } = setup();
		settingMap.set('Chem.Board', false);
		expect(registry.isFeatureActive('Chem.Board')).toBe(false);
		expect(registry.extension('Board.Editor')).toBeUndefined();
		const list = registry.settingList().filter((item) => item.feature === 'Chem.Board');
		expect(list.map((item) => [item.setting.id, item.setting.type])).toEqual([
			['Chem.Board', 'Toggle'],
			['Chem.BoardGrid', 'Toggle'],
		]);
	});
});
