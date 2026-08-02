import {
  describeMetaError,
  isOutsideWindow,
  readMetaError,
  OUTSIDE_WINDOW_CODE,
} from './cloud-api.error';

describe('readMetaError', () => {
  it('lê código, mensagem e o details, que é onde está o motivo real', () => {
    const error = readMetaError({
      error: {
        message: 'Message failed to send',
        code: OUTSIDE_WINDOW_CODE,
        error_data: { details: 'more than 24 hours have passed' },
      },
    });

    expect(error).toEqual({
      code: 131047,
      message: 'Message failed to send',
      details: 'more than 24 hours have passed',
    });
  });

  it('tolera erro sem error_data', () => {
    expect(readMetaError({ error: { message: 'Invalid parameter', code: 100 } })).toEqual({
      code: 100,
      message: 'Invalid parameter',
    });
  });

  it('não quebra com corpo fora do formato da Meta', () => {
    expect(readMetaError('gateway timeout').message).toBe('gateway timeout');
    expect(readMetaError(null).message).toBe('sem corpo');
    expect(readMetaError({ foo: 'bar' }).message).toBe('{"foo":"bar"}');
  });
});

describe('isOutsideWindow', () => {
  it('reconhece só o 131047', () => {
    expect(isOutsideWindow({ code: 131047, message: 'x' })).toBe(true);
    expect(isOutsideWindow({ code: 131026, message: 'x' })).toBe(false);
    expect(isOutsideWindow({ message: 'x' })).toBe(false);
  });
});

describe('describeMetaError', () => {
  it('junta status, código e details numa linha acionável', () => {
    const text = describeMetaError(400, {
      code: 131047,
      message: 'Message failed to send',
      details: 'more than 24 hours have passed',
    });

    expect(text).toBe(
      'Cloud API respondeu 400 (código 131047): Message failed to send — more than 24 hours have passed',
    );
  });
});
