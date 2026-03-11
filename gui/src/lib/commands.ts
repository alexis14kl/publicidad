import type { BotStatus, LastJob, CommandResult } from './types'

const api = () => window.electronAPI

export const getBotStatus = (): Promise<BotStatus> => api().getBotStatus()
export const getLastJob = (): Promise<LastJob | null> => api().getLastJob()
export const startBot = (profileName?: string): Promise<CommandResult> => api().startBot(profileName)
export const stopBot = (): Promise<CommandResult> => api().stopBot()
export const startPoller = (): Promise<CommandResult> => api().startPoller()
export const stopPoller = (): Promise<CommandResult> => api().stopPoller()
export const isPollerRunning = (): Promise<boolean> => api().isPollerRunning()
export const readLogLines = (count?: number): Promise<string[]> => api().readLogLines(count)
export const getEnvConfig = (): Promise<Record<string, string>> => api().getEnvConfig()
export const onLogNewLines = (cb: (lines: string[]) => void) => api().onLogNewLines(cb)
