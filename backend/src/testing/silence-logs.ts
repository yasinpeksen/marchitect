import { Logger } from '@nestjs/common';

// Unit tests assert behaviour, not log output: keep the test run readable.
Logger.overrideLogger(false);
