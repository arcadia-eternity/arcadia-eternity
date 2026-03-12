#!/bin/bash
# Migrate world.meta to world.state and world.systems

set -e

# Files to process (excluding tests)
FILES=$(find packages/battle/src/v2 -name "*.ts" -not -path "*__tests__*")

# State fields (serializable battle state)
STATE_FIELDS=(
  "playerAId"
  "playerBId"
  "status"
  "currentTurn"
  "currentPhase"
  "victor"
  "endReason"
  "selections"
  "waitingPlayerIds"
  "pendingForcedSwitchPlayerIds"
  "pendingFaintSwitchPlayerId"
  "lastKillerId"
  "allowFaintSwitch"
)

# Systems fields (already migrated)
# rng, systems, battleConfig, seed

echo "Migrating world.meta to world.state..."

for file in $FILES; do
  # Skip if file doesn't contain world.meta
  if ! grep -q "world\.meta\." "$file"; then
    continue
  fi

  echo "Processing: $file"

  # Replace state fields: world.meta.xxx -> world.state.xxx
  for field in "${STATE_FIELDS[@]}"; do
    sed -i '' "s/world\.meta\.$field/world.state.$field/g" "$file"
  done

  # Replace (world.meta as any).xxx -> (world.state as any).xxx for state fields
  for field in "${STATE_FIELDS[@]}"; do
    sed -i '' "s/(world\.meta as any)\.$field/(world.state as any).$field/g" "$file"
  done
done

echo "Migration complete!"
echo "Remaining world.meta usages:"
grep -rn "world\.meta\." packages/battle/src/v2 --include="*.ts" | grep -v "__tests__" | wc -l
