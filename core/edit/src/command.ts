import type { CommandDefinition } from '@octaether/core-sdk';

/** Every action is a command; buttons, menus, hotkeys, and gestures only point at command IDs. */
export class CommandRegistry {
	private readonly commandMap = new Map<string, CommandDefinition>();
	private readonly listenerSet = new Set<() => void>();

	register(command: CommandDefinition): () => void {
		if (!/^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)+$/.test(command.id)) {
			throw new Error(`command "${command.id}" must be PascalCase segments joined by dots, e.g. Block.Insert`);
		}
		if (this.commandMap.has(command.id)) throw new Error(`command "${command.id}" is already registered`);
		this.commandMap.set(command.id, command);
		this.emit();
		return () => {
			if (this.commandMap.get(command.id) === command) {
				this.commandMap.delete(command.id);
				this.emit();
			}
		};
	}

	get(id: string): CommandDefinition | undefined {
		return this.commandMap.get(id);
	}

	list(): CommandDefinition[] {
		return [...this.commandMap.values()].sort((left, right) => left.id.localeCompare(right.id));
	}

	/** Runs a command; returns false when no such command is registered. */
	run(id: string, argument?: unknown): boolean {
		const command = this.commandMap.get(id);
		if (!command) return false;
		command.run(argument);
		return true;
	}

	subscribe(listener: () => void): () => void {
		this.listenerSet.add(listener);
		return () => this.listenerSet.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listenerSet) listener();
	}
}
