-- 返金の操作ごとの識別子。同じ操作が 2 回届いても（通信の再送など）、二重に記録しない
ALTER TABLE refunds ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX idx_refunds_request ON refunds(order_id, request_id) WHERE request_id IS NOT NULL;
