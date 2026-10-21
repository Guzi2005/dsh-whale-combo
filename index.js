/**
 * Host half of dsh-whale-combo.
 *
 * The merged status bubble and the charge danmaku are a pure browser-side
 * surface: they live in the `shell.overlay` slot of the Web UI and read the
 * same-origin data routes that dsh-damage-pulse and dsh-whale-widget already
 * serve. Nothing therefore needs to run on the Host; this module exists so the
 * bundle owns a plugin row of its own (enable / disable / uninstall in the
 * Plugins page) instead of patching another package's files.
 */
export function apply() {}
