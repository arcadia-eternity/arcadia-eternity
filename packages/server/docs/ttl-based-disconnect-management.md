# TTL-Based Disconnect Management

This document describes the TTL-based disconnect management system that replaces local timers with Redis TTL for handling player disconnections in a cluster environment.

## Overview

The new system completely relies on Redis TTL (Time To Live) for managing player disconnect grace periods, providing:

- **Cluster Support**: Works seamlessly across multiple server instances
- **Automatic Cleanup**: Redis automatically removes expired keys
- **Consistency**: All instances see the same TTL state
- **Reliability**: No dependency on local timers that can be lost during crashes

## Architecture

### Key Components

1. **TTL Configuration** (`ttlConfig.ts`)
   - Centralized TTL management
   - Environment-specific grace periods
   - Dynamic TTL calculation

2. **Redis Keyspace Notifications** (`redisKeyspaceConfig.ts`)
   - Enables expired key event listening
   - Automatic Redis configuration
   - Testing utilities

3. **Cluster Battle Service** (`clusterBattleService.ts`)
   - TTL expiration event handling
   - Cross-instance coordination
   - Automatic battle abandonment

4. **Cluster Battle Server** (`clusterBattleServer.ts`)
   - Updated disconnect handling
   - TTL-based grace period management

### Data Flow

```
Player Disconnects
       ↓
Store in Redis with TTL
       ↓
Redis Key Expires (TTL = 0)
       ↓
Keyspace Notification Event
       ↓
Handle Battle Abandonment
```

## Configuration

### Redis Configuration

The system requires Redis keyspace notifications to be enabled. This is done automatically during cluster initialization:

```typescript
// Automatically configured in ClusterStateManager
notify-keyspace-events = Ex
```

### Environment Variables

```bash
# Disconnect grace period TTL (milliseconds)
DISCONNECT_GRACE_PERIOD_TTL=60000  # Production: 120000 (2 min), Dev: 60000 (1 min)

# Reconnect window TTL (for cross-instance support)
RECONNECT_WINDOW_TTL=180000  # Production: 300000 (5 min), Dev: 180000 (3 min)

# Optional: Apply Redis optimizations
APPLY_REDIS_OPTIMIZATIONS=true
```

### TTL Configuration

TTL values are defined in `ttlConfig.ts`:

```typescript
disconnect: {
  gracePeriodTTL: 60000,    // Main disconnect grace period
  reconnectWindowTTL: 180000 // Extended window for cross-instance reconnects
}
```

## Usage

### Player Disconnect Handling

When a player disconnects during battle:

1. **Grace Period Start**: Store disconnect info in Redis with TTL
2. **TTL Expiration**: Redis automatically triggers expiration event
3. **Abandonment Handling**: System processes battle abandonment
4. **Cleanup**: All related data is automatically cleaned up

### Cross-Instance Support

The system supports players reconnecting to different server instances:

- Disconnect info is stored in Redis (accessible cluster-wide)
- TTL expiration events are handled by any instance
- Cross-instance notifications coordinate battle state

### Monitoring

The system provides comprehensive logging:

```
INFO: Disconnected player TTL expired, handling battle abandonment
INFO: Player abandonment handled after TTL expiry
WARN: TTL-based disconnect management may not work properly without keyspace notifications
```

## Redis Requirements

### Minimum Redis Version
- Redis 2.8.0+ (for keyspace notifications)
- Redis 4.0.0+ recommended (for improved TTL precision)

### Required Configuration
```redis
# Enable keyspace notifications for expired events
CONFIG SET notify-keyspace-events Ex

# Optional optimizations
CONFIG SET tcp-keepalive 60
CONFIG SET timeout 0
CONFIG SET maxmemory-policy allkeys-lru
```

### Memory Considerations
- Disconnect entries are small (~200 bytes each)
- Automatic cleanup via TTL prevents memory leaks
- Configure `maxmemory-policy` for memory pressure scenarios

## Monitoring and Debugging

### Testing TTL Expiration

In development mode, the system automatically tests TTL expiration:

```typescript
const testResult = await RedisKeyspaceConfig.testTTLExpiration(client, subscriber)
```

### Key Monitoring Points

1. **TTL Configuration**: Verify grace periods are appropriate
2. **Keyspace Notifications**: Ensure Redis is properly configured
3. **Cross-Instance Events**: Monitor inter-instance communication
4. **Battle Abandonment**: Track abandonment due to TTL expiry

### Common Issues

1. **Keyspace Notifications Disabled**
   - Symptom: TTL expiration events not received
   - Solution: Enable `notify-keyspace-events Ex` in Redis

2. **TTL Too Short/Long**
   - Symptom: Premature or delayed abandonments
   - Solution: Adjust `DISCONNECT_GRACE_PERIOD_TTL`

3. **Redis Memory Pressure**
   - Symptom: Keys expelled before TTL expiry
   - Solution: Configure `maxmemory-policy` and increase memory

## Migration from Timer-Based System

### Key Changes

1. **No Local Timers**: All disconnect timing now handled by Redis TTL
2. **Event-Driven**: System responds to Redis expiration events
3. **Cluster-Aware**: Supports multi-instance deployments
4. **Automatic Cleanup**: No manual cleanup required

### Backward Compatibility

The system maintains backward compatibility:
- Local timer as backup mechanism
- Graceful degradation if keyspace notifications fail
- Existing disconnect handling APIs preserved

## Performance Impact

### Benefits
- Reduced memory usage (no local timer objects)
- Better cluster consistency
- Automatic garbage collection
- Simplified state management

### Considerations
- Additional Redis operations for TTL management
- Network latency for keyspace notifications
- Redis memory usage for disconnect entries

## Security Considerations

### Access Control
- Ensure Redis access is properly secured
- Keyspace notifications don't expose sensitive data
- TTL values are not externally manipulable

### Data Protection
- Disconnect info contains minimal player data
- Automatic cleanup prevents data persistence
- Cross-instance events use secure channels

## Future Enhancements

1. **Dynamic TTL Adjustment**: Adjust grace periods based on network conditions
2. **Prioritized Disconnects**: Different TTLs for different player types
3. **Analytics Integration**: Track disconnect patterns and reasons
4. **Advanced Recovery**: Sophisticated reconnection strategies