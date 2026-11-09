import { ArgumentsHost, BadRequestException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { AllExceptionsFilter, toErrorBody } from './http-exception.filter';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

describe('toErrorBody', () => {
  it('maps an HttpException with a structured body', () => {
    const body = toErrorBody(new NotFoundException('Ad not found'), '/api/v1/ads/1');
    expect(body).toMatchObject({ statusCode: 404, error: 'Not Found', message: 'Ad not found', path: '/api/v1/ads/1' });
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('keeps validation message arrays', () => {
    expect(toErrorBody(new BadRequestException(['a must be a string', 'b is required']), '/x').message).toEqual(['a must be a string', 'b is required']);
  });

  it('handles an HttpException with a plain string response', () => {
    expect(toErrorBody(new HttpException('Teapot', 418), '/x')).toMatchObject({ statusCode: 418, message: 'Teapot' });
  });

  it('hides unknown errors behind a generic 500', () => {
    expect(toErrorBody(new Error('secret internals'), '/x')).toMatchObject({
      statusCode: 500, error: 'InternalServerError', message: 'Internal server error',
    });
  });
});

describe('AllExceptionsFilter', () => {
  const buildHost = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ url: '/api/v1/test' }) }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('responds with the mapped status and body without reporting HTTP errors', () => {
    const { host, status, json } = buildHost();
    new AllExceptionsFilter().catch(new NotFoundException('missing'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'missing', path: '/api/v1/test' }));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('logs and reports unexpected errors', () => {
    const { host, status } = buildHost();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failure = new Error('boom');
    new AllExceptionsFilter().catch(failure, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
