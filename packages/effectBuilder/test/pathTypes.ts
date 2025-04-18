import { Pet } from '@arcadia-eternity/battle'
import type { Path } from '../extractor'

type checkOwner = Path<Pet, 'owner'> //expect player

type checkOwnerName = Path<Pet, 'owner.name'> //expect string

type checkStat = Path<Pet, 'stat'> //expect StatOnBattle

type checkStatAtk = Path<Pet, 'stat.atk'> //expect number

type checkStatModifiers = Path<Pet, 'statStage.atk'> //number

type checkMark = Path<Pet, 'marks'> //expect markInstance[]

type checkMarkDurations = Path<Pet, 'marks[].duration'> // expect number[]

type checkMarkTag = Path<Pet, 'marks[].tags'> //expect string[][]

type checkMarkTags = Path<Pet, 'marks[].tags[]'> //expect string[][]

type checkOwnerActivePet = Path<Pet, 'owner.activePet'> // expect Pet

type checkSkills = Path<Pet, 'skills'> // expect SkillInstance[]

type checkSkill = Path<Pet, 'skills[]'> //expect SkillInstance[]

type checkSkillTag = Path<Pet, 'skills[].tag'> //expect string[][]

type checkSkillsOwner = Path<Pet, 'skills[].owner'> //expect Pet[]

type checkSkillsOwnerName = Path<Pet, 'skills[].owner.name'> //expect string[]
