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
      title: 'Setup inicial',
      timeRange: '0s - 7s',
      prompt: 'Escribe el prompt del video y el agente video-scene-creator armara aqui la primera escena de 7 segundos.',
      dialogue: 'Aqui aparecera un voiceover corto y claro para la primera escena.',
    },
    {
      id: 'scene-2',
      label: 'Escena 02',
      title: 'Giro o desarrollo',
      timeRange: '7s - 14s',
      prompt: 'La segunda escena mostrara el conflicto, el valor o el momento principal del video con continuidad visual.',
      dialogue: 'Aqui aparecera un voiceover alineado con la accion visible de la segunda escena.',
    },
    {
      id: 'scene-3',
      label: 'Escena 03',
      title: 'Cierre o consecuencia',
      timeRange: '14s - 21s',
      prompt: 'La tercera escena cerrara la mini-historia con una consecuencia, un remate o un CTA claro.',
      dialogue: 'Aqui aparecera un voiceover final mas contundente y natural.',
    },
  ]
}
