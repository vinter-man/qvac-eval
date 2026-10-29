export const noComments = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow comments so that code has to explain itself' },
    schema: [],
    messages: {
      comment:
        'Remove this comment. Express the intent in code, or move the rationale to the pull request or an ADR.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type !== 'Shebang')
            context.report({ loc: comment.loc, messageId: 'comment' });
        }
      },
    };
  },
};
