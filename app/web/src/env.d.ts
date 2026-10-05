/// <reference types="vite/client" />

// File System Access API (Chromium); optional everywhere else. Only what the app uses.
interface FilePickerOption {
	types?: { description?: string; accept: Record<string, string[]> }[];
	suggestedName?: string;
	id?: string;
	mode?: 'read' | 'readwrite';
	/** Where the picker opens: a folder picked before, or a well-known one. */
	startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads';
}

interface FileSystemHandlePermissionDescriptor {
	mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
	queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
	requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
	move?(parent: FileSystemDirectoryHandle, name: string): Promise<void>;
}

interface FileSystemDirectoryHandle {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
	keys(): AsyncIterableIterator<string>;
}

// Files opened with the installed app from the computer's file manager (Chromium).
interface LaunchParams {
	readonly files: readonly FileSystemHandle[];
}

interface LaunchQueue {
	setConsumer(consumer: (params: LaunchParams) => void): void;
}

interface Window {
	showOpenFilePicker?(option?: FilePickerOption): Promise<FileSystemFileHandle[]>;
	showSaveFilePicker?(option?: FilePickerOption): Promise<FileSystemFileHandle>;
	showDirectoryPicker?(option?: FilePickerOption): Promise<FileSystemDirectoryHandle>;
	launchQueue?: LaunchQueue;
}
