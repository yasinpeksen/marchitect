import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Response } from 'express';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/** Converts any thrown value into the consistent API error body. Unknown errors become 500. */
export function toErrorBody(exception: unknown, path: string): ErrorBody {
  let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let message: string | string[] = 'Internal server error';
  let error = 'InternalServerError';

  if (exception instanceof HttpException) {
    statusCode = exception.getStatus();
    const responseBody = exception.getResponse();
    if (typeof responseBody === 'string') {
      message = responseBody;
    } else {
      const structured = responseBody as { message?: string | string[]; error?: string };
      message = structured.message ?? exception.message;
      error = structured.error ?? exception.name;
    }
  }
  return { statusCode, error, message, path, timestamp: new Date().toISOString() };
}

/** Consistent error body: { statusCode, error, message, path, timestamp }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<{ url: string }>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      Sentry.captureException(exception);
    }
    const body = toErrorBody(exception, request.url);
    response.status(body.statusCode).json(body);
  }
}
