import type { FastifyInstance } from 'fastify';
import type { OtpService } from '../../services/otp-service.js';
import { sendOtpBody } from '../schemas.js';

/**
 * Registers `POST /v1/otps` — sends an SMS verification code. Returns
 * `200 { otp: { status: 'pending' } }`; a malformed phone becomes a 400 naming
 * phone_number via the error handler (the OtpService normalizes before send).
 */
export function registerOtpRoutes(app: FastifyInstance, otpService: OtpService): void {
  app.post('/v1/otps', async (request, reply) => {
    const { otp } = sendOtpBody.parse(request.body);
    const result = await otpService.requestOtp(otp.phone_number);
    return reply.code(200).send({ otp: result });
  });
}
