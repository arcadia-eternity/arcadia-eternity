# Team Selection System Guide

## Overview

The Team Selection System allows players to choose which pets from their full team will participate in battle and which pet will start the battle. This system supports multiple modes and configurations to accommodate different battle formats.

## Key Features

- **Multiple Selection Modes**: View-only, team selection, and full team modes
- **Flexible Configuration**: Customizable team sizes, time limits, and visibility settings
- **AI Support**: Intelligent AI team selection with strategic decision making
- **Real-time Updates**: Live progress tracking and opponent visibility options
- **Validation System**: Comprehensive validation with detailed error reporting
- **Performance Optimized**: Caching and batch processing for large teams

## Basic Usage

### 1. Creating a Team Selection Rule

```typescript
import { TeamSelectionRule } from '@arcadia-eternity/rules'

const teamSelectionRule = new TeamSelectionRule().setConfig({
  mode: 'TEAM_SELECTION',
  maxTeamSize: 6,
  minTeamSize: 1,
  allowStarterSelection: true,
  showOpponentTeam: false,
  teamInfoVisibility: 'HIDDEN',
  timeLimit: 60, // seconds
})
```

### 2. Adding to Rule Set

```typescript
const ruleSet: RuleSet = {
  id: 'competitive-6v6',
  name: 'Competitive 6v6',
  description: 'Standard competitive format with team selection',
  version: '1.0.0',
  rules: [teamSelectionRule],
}
```

### 3. Making a Team Selection

```typescript
const teamSelection: BattleTeamSelection = {
  selectedPets: ['pet-1', 'pet-3', 'pet-5'], // Pet IDs to use in battle
  starterPetId: 'pet-1', // Pet that starts the battle
}

// Submit selection
player.setSelection({
  type: 'team-selection',
  player: playerId,
  selectedPets: teamSelection.selectedPets,
  starterPetId: teamSelection.starterPetId,
})
```

## Configuration Options

### Selection Modes

#### VIEW_ONLY
- Players can see team information but cannot make changes
- Useful for team preview phases
- Automatically proceeds after time limit

```typescript
{
  mode: 'VIEW_ONLY',
  showOpponentTeam: true,
  teamInfoVisibility: 'FULL',
  timeLimit: 10,
}
```

#### TEAM_SELECTION
- Players choose which pets to bring to battle
- Most flexible mode for competitive play
- Supports custom team sizes

```typescript
{
  mode: 'TEAM_SELECTION',
  maxTeamSize: 4,
  minTeamSize: 2,
  allowStarterSelection: true,
  timeLimit: 30,
}
```

#### FULL_TEAM
- All pets participate in battle
- Players only choose starter pet (if enabled)
- Good for casual or story mode battles

```typescript
{
  mode: 'FULL_TEAM',
  allowStarterSelection: true,
  timeLimit: 15,
}
```

### Visibility Settings

#### teamInfoVisibility Options

- **HIDDEN**: No opponent team information shown
- **BASIC**: Show pet names and basic info only
- **FULL**: Show complete pet information including stats and HP

#### showOpponentTeam

- `true`: Display opponent's team during selection
- `false`: Hide opponent's team for blind selection

## Frontend Integration

### Web UI Component

```vue
<template>
  <TeamSelectionPanel
    :fullTeam="playerTeam"
    :opponentTeam="opponentTeam"
    :config="selectionConfig"
    :timeLimit="timeRemaining"
    :initialSelection="currentSelection"
    @selectionChange="onSelectionChange"
    @confirm="onConfirm"
    @timeout="onTimeout"
  />
</template>

<script setup>
import TeamSelectionPanel from '@/components/battle/TeamSelectionPanel.vue'

const onSelectionChange = (selection) => {
  // Handle selection updates
  currentSelection.value = selection
}

const onConfirm = async (selection) => {
  // Submit final selection
  await battleStore.sendPlayerSelection({
    type: 'team-selection',
    player: playerId,
    selectedPets: selection.selectedPets,
    starterPetId: selection.starterPetId,
  })
}
</script>
```

### Console UI Integration

```typescript
// Console UI automatically handles team selection
// Players interact through text-based prompts
console.log('Select your team (enter pet numbers separated by spaces):')
const input = await prompt('Selection: ')
const indices = input.split(' ').map(s => parseInt(s.trim()))
```

## AI Implementation

### Basic AI Selection

```typescript
class AIPlayer extends Player {
  private makeTeamSelectionDecision(): PlayerSelection {
    const rule = this.battle.ruleSet.rules.find(r => r instanceof TeamSelectionRule)
    const config = rule.getConfig()
    
    if (config.mode === 'TEAM_SELECTION') {
      return this.makeStrategicTeamSelection(config)
    }
    
    return this.makeDefaultSelection()
  }
}
```

### Strategic AI Logic

The AI considers multiple factors when making team selections:

1. **Pet Health**: Prioritizes pets with higher HP ratios
2. **Level**: Favors higher-level pets
3. **Stats**: Considers overall stat distribution
4. **Role Balance**: Attempts to create balanced teams
5. **Starter Selection**: Chooses fast, strong pets for starting

## Performance Optimization

### Using Optimized Validator

```typescript
import { OptimizedTeamSelectionValidator } from '@arcadia-eternity/battle'

const validator = new OptimizedTeamSelectionValidator()

// Validation with caching
const result = validator.validateTeamSelection(selection, fullTeam, config)

// Check cache performance
const stats = validator.getCacheStats()
console.log(`Cache hit rate: ${stats.hitRate * 100}%`)
```

### Batch Processing

```typescript
import { BatchTeamSelectionProcessor } from '@arcadia-eternity/battle'

// Process multiple selections efficiently
const results = BatchTeamSelectionProcessor.processBatch(selections, validator)

// Parallel processing for large batches
const parallelResults = await BatchTeamSelectionProcessor.processBatchParallel(selections)
```

## Error Handling

### Common Validation Errors

- **TEAM_SIZE_TOO_SMALL**: Selected team is smaller than minimum required
- **TEAM_SIZE_TOO_LARGE**: Selected team exceeds maximum allowed
- **DUPLICATE_PET_SELECTION**: Same pet selected multiple times
- **PET_NOT_FOUND**: Selected pet doesn't exist in full team
- **FAINTED_PET_SELECTED**: Attempted to select a fainted pet
- **STARTER_NOT_IN_TEAM**: Starter pet is not in selected team
- **INVALID_STARTER_PET**: Starter pet is invalid or fainted

### Error Handling Example

```typescript
const validationResult = rule.validateTeamSelection(selection, fullTeam)

if (!validationResult.isValid) {
  validationResult.errors.forEach(error => {
    console.error(`Validation Error: ${error.message} (Code: ${error.code})`)
  })
  
  // Handle specific errors
  if (validationResult.errors.some(e => e.code === 'TEAM_SIZE_TOO_SMALL')) {
    // Prompt user to select more pets
  }
}
```

## Testing

### Unit Tests

```typescript
import { TeamSelectionRule } from '@arcadia-eternity/rules'

describe('TeamSelectionRule', () => {
  it('should validate correct team selection', () => {
    const rule = new TeamSelectionRule().setConfig({
      mode: 'TEAM_SELECTION',
      maxTeamSize: 6,
      minTeamSize: 1,
      allowStarterSelection: true,
    })
    
    const selection = {
      selectedPets: ['pet-1', 'pet-2'],
      starterPetId: 'pet-1',
    }
    
    const result = rule.validateTeamSelection(selection, mockTeam)
    expect(result.isValid).toBe(true)
  })
})
```

### E2E Tests

```typescript
describe('Team Selection E2E', () => {
  it('should complete full team selection flow', async () => {
    const battle = new Battle(player1, player2, ruleSet)
    const battlePromise = battle.startBattle()
    
    // Wait for team selection phase
    await waitForMessage(BattleMessageType.TeamSelectionStart)
    
    // Make selections
    player1.setSelection(teamSelection1)
    player2.setSelection(teamSelection2)
    
    // Verify completion
    await waitForMessage(BattleMessageType.TeamSelectionComplete)
    expect(player1.battleTeam.length).toBeGreaterThan(0)
  })
})
```

## Best Practices

1. **Always validate selections** before applying them
2. **Use caching** for repeated validations
3. **Handle timeouts gracefully** with default selections
4. **Provide clear error messages** to users
5. **Test with edge cases** like all fainted pets
6. **Monitor performance** with large teams
7. **Clear caches periodically** to prevent memory leaks

## Troubleshooting

### Common Issues

**Team selection not starting**
- Check if TeamSelectionRule is included in rule set
- Verify battle phase transitions are working

**Validation always failing**
- Check pet HP values (fainted pets can't be selected)
- Verify pet IDs match between selection and full team
- Ensure team size is within configured limits

**AI not making selections**
- Check AI decision timing configuration
- Verify AI has access to team selection rules
- Look for errors in AI decision logic

**Performance issues**
- Enable caching for repeated validations
- Use batch processing for multiple selections
- Monitor memory usage and clear caches regularly

## Migration Guide

### From Previous Versions

If upgrading from a system without team selection:

1. Add TeamSelectionRule to existing rule sets
2. Update battle initialization to handle team selection phase
3. Modify UI to show team selection interface
4. Update AI players to handle team selection decisions
5. Add validation for team selection messages

### Breaking Changes

- Battle flow now includes team selection phase
- Player.battleTeam may differ from Player.team
- New message types: TeamSelectionStart, TeamSelectionComplete
- Additional validation requirements for pet selections

## API Reference

See the TypeScript definitions for complete API documentation:

- `TeamSelectionRule` - Main rule implementation
- `BattleTeamSelection` - Selection data structure
- `TeamSelectionConfig` - Configuration options
- `TeamSelectionPhase` - Battle phase implementation
- `OptimizedTeamSelectionValidator` - Performance-optimized validator
