export function updatePhase(
  user,
  msg,
  aiResponse,
  helpers = {}
) {

  const {
    isValidName,
    extractLevel,
    CONFIRMATION_WORDS = []
  } = helpers;

  const text =
    msg?.trim() || "";

  switch (user.phase) {

    /*
    ====================
    NAME
    ====================
    */

    case "intro":

      if (
        isValidName(text)
      ) {

        user.name = text;
        user.phase = "onboarding";

      }

      break;

    /*
    ====================
    LEVEL
    ====================
    */

    case "onboarding": {

      const level =
        extractLevel(text);

      if (
        level !== null
      ) {

        user.level = level;
        user.phase = "diagnostic";

      }

      break;
    }

    /*
    ====================
    FEARS
    ====================
    */

    case "diagnostic":

      if (
        text.length > 2
      ) {

        user.fears = text;

      }

      if (
        aiResponse?.metadata?.weakTopicsDetected
      ) {

        user.weakTopics = [

          ...new Set([

            ...(user.weakTopics || []),

            ...aiResponse.metadata
              .weakTopicsDetected

          ])

        ];

      }

      user.phase = "planning";

      break;

    /*
    ====================
    PLAN CONFIRM
    ====================
    */

    case "planning": {

      const confirmed =

        CONFIRMATION_WORDS.some(
          w =>
            text
              .toLowerCase()
              .includes(
                w.toLowerCase()
              )
        );

      if (

        confirmed ||

        text.length > 20 ||

        user.planningAttempts >= 2

      ) {

        user.phase =
          "training";

      }

      else {

        user.planningAttempts =
          (user.planningAttempts || 0) + 1;

      }

      break;
    }

    /*
    ====================
    TRAINING
    ====================
    */

    case "training":
      break;

    default:
      break;

  }

  return user;

}