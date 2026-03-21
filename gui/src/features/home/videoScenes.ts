import type { VideoScenePlanItem } from '../../shared/api/types'

export type VideoSceneItem = VideoScenePlanItem

export interface VideoSceneHistoryEntry {
  prompt: string
  createdAt: string
  compiledPrompt: string
  scenes: VideoScenePlanItem[]
}

export function buildEmptyVideoScenes(): VideoScenePlanItem[] {
  return [
    {
      id: 'scene-1',
      label: 'Escena 01',
      title: 'Hook inicial',
      timeRange: '0s - 5s',
      prompt: 'Escribe el prompt del video y el agente video-scene-creator armara aqui la primera escena.',
      dialogue: 'Aqui aparecera el primer dialogo sugerido.',
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'Valor o desarrollo',
      timeRange: '5s - 10s',
      prompt: 'La segunda escena mostrara el beneficio, la demostracion o el momento principal del video.',
      dialogue: 'Aqui aparecera el segundo dialogo sugerido.',
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'Cierre con CTA',
      timeRange: '10s - 15s',
      prompt: 'La tercera escena cerrara con una accion clara antes de enviar el plan al bot.',
      dialogue: 'Aqui aparecera el tercer dialogo sugerido.',
    },
  ]
}
