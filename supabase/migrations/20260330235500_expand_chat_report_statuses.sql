UPDATE public.chat_reports
SET status = 'in_review'
WHERE status = 'reviewed';

ALTER TABLE public.chat_reports
DROP CONSTRAINT IF EXISTS chat_reports_status_check;

ALTER TABLE public.chat_reports
ADD CONSTRAINT chat_reports_status_check
CHECK (status IN ('open', 'in_review', 'warned', 'blocked', 'banned', 'dismissed'));
