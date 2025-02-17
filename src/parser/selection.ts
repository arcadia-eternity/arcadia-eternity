import { Battle } from '@/core/battle'
import { BattleContext } from '@/core/context'
import { Player } from '@/core/player'
import { PlayerSelection } from '@/core/selection'
import { Pet, Skill } from '@/schema'
import { UseSkillSelectionSchema, SwitchPetSelectionSchema } from '@/schema/selection'
import { z } from 'zod'

type ParsedSelection<T> = T & {
  $player: Player
  $pet?: Pet
  $skill?: Skill
}

class SelectionParser {
  //需要注入战斗实例
  constructor(private battle: Battle) {}

  // 通用解析入口
  parse(raw: unknown): ParsedSelection<PlayerSelection> {
    const schema = z.union([UseSkillSelectionSchema, SwitchPetSelectionSchema])
    const parsed = schema.parse(raw) // Zod 基础校验

    return this.parseWithContext(parsed)
  }

  private parseWithContext(selection: PlayerSelection): ParsedSelection<PlayerSelection> {
    switch (selection.type) {
      case 'use-skill':
        return this.parseUseSkill(selection)
      case 'switch-pet':
        return this.parseSwitchPet(selection)
      default:
        throw new Error('Unsupported selection type')
    }
  }

  private parseUseSkill(selection: z.infer<typeof UseSkillSelectionSchema>): ParsedSelection<typeof selection> {
    const player = this.context.getPlayer(selection.playerId)
    if (!player) throw new Error('Player not found')

    const pet = this.context.getPet(player, selection.petId)
    if (!pet) throw new Error('Pet not owned or invalid')

    const skill = this.context.getSkill(pet, selection.skillId)
    if (!skill) throw new Error('Skill not available')

    return {
      ...selection,
      $player: player,
      $pet: pet,
      $skill: skill,
    }
  }

  private parseSwitchPet(selection: z.infer<typeof SwitchPetSelectionSchema>): ParsedSelection<typeof selection> {
    const player = this.context.getPlayer(selection.playerId)
    if (!player) throw new Error('Player not found')

    const pet = this.context.getPet(player, selection.petId)
    if (!pet) throw new Error('Pet not owned or invalid')
    if (!pet.isAlive) throw new Error('Pet is fainted')

    return {
      ...selection,
      $player: player,
      $pet: pet,
    }
  }
}
