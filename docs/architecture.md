# Architecture Deep Dive

## Logical view

```text
[Web/React] --HTTPS/WSS--> [API Gateway]
                               |
           +-------------------+-------------------+
           |                   |                   |
      [Auth Service]      [Chat Service]     [Media Service]
           |                   |                   |
       [PostgreSQL]      [PostgreSQL]         [S3/MinIO]
                               |
                           [Redis Pub/Sub]
                               |
                      [Notification Service]
```

## Scalability model
- Stateless services behind L4/L7 load balancer.
- Redis Pub/Sub for intra-cluster message fan-out.
- PostgreSQL partitioning by chat/time for high-volume history.
- CDN in front of encrypted media.

## Realtime pipeline
1. Client sends encrypted envelope to `/v1/messages`.
2. Chat service verifies membership and stores ciphertext.
3. Message event published to Redis channel.
4. Each gateway node subscribes and pushes to connected sockets.

## Large group/channel strategy
- Membership shards by `chat_id`.
- Async moderation pipeline with metadata-only checks.
- Channel posts cached in Redis for hot fanout reads.
