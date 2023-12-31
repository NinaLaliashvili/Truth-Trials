import React, { useContext } from "react";
import { useNavigate } from "react-router-dom";
import "./ResultsComponent.css";
import { LoginContext } from "../../Context/AuthContext";
import { userScoreContext } from "../../Context/UserScoreContext";

const ResultComponent = () => {
  const { userId, isLoggedIn } = useContext(LoginContext);

  const { saveScoreToBackend } = useContext(userScoreContext);

  const {
    numOfCorrectAnswers,
    numOfWrongAnswers,
    runningAverageScore,
    resetScore,
    userAnswers,
  } = useContext(userScoreContext);

  const highScoring = runningAverageScore > 70;
  const navigate = useNavigate();

  const handlePlayAgain = () => {
    resetScore();
    navigate("/quiz");
  };

  const handleSaveScore = async () => {
    if (userId) {
      await saveScoreToBackend(userId);
      navigate("/leaderboard");
    } else {
      console.error("No user ID available");
    }
  };

  return (
    <div className="result-container">
      <main className="results-content">
        <h3 className="score-heading">{`Your Score: ${numOfCorrectAnswers}`}</h3>
        <div className="score-details">
          <p>{`Correct Answers: ${numOfCorrectAnswers}`}</p>
          <p>{`Wrong Answers: ${numOfWrongAnswers}`}</p>
        </div>
        <p className={highScoring ? "feedback-positive" : "feedback-negative"}>
          {highScoring
            ? "Great work! You are well on your way to identifying conspiracy theories you encounter in everyday life."
            : "You need work! Get off TikTok! Read!"}
        </p>

        <h4 className="review-heading">Let's Review Your Answers</h4>
        <ul className="answers-review-list">
          {userAnswers.map((answer, index) => (
            <li key={index} className="answer-item">
              <strong>Question:</strong> {answer.question} <br />
              {answer.imgLink && (
                <img
                  src={answer.imgLink}
                  alt="uploaded"
                  style={{ width: "100px", height: "100px" }}
                />
              )}
              {answer.imgLink && <p>Image URL: {answer.imgLink}</p>}
              <strong>You answered:</strong>{" "}
              {answer.userAnswer === "fact" ? "Fact" : "Fiction"} <br />
              <span
                className={
                  answer.userAnswer === answer.correctAnswer
                    ? "correct"
                    : "wrong"
                }
              >
                {answer.userAnswer === answer.correctAnswer
                  ? "Correct!"
                  : `Incorrect! Correct answer was: ${
                      answer.correctAnswer === "fact" ? "Fact" : "Fiction"
                    }`}
              </span>
            </li>
          ))}
        </ul>

        <div className="button-group">
          <button onClick={handlePlayAgain} className="play-again-button">
            Play Again!
          </button>
          {isLoggedIn && (
            <button onClick={handleSaveScore} className="leaderboard-button">
              Save your score & check out the leaderboard!
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

export default ResultComponent;
