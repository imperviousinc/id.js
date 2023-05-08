export class CommitmentNotRequiredError extends Error {
  constructor() {
    super('Commitment not required');
  }
}
