import "./App.css";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  Navigate,
} from "react-router-dom";
import HomeComponent from "./Components/Home/HomeComponent";
import QuizComponent from "./Components/Quiz/QuizComponent";
import ResultComponent from "./Components/Results/ResultsComponent";
import LeaderboardComponent from "./Components/Leaderboard/LeaderboardComponent";
import SubmitFactComponent from "./Components/SubmitFact/SubmitFactComponent";
import LogInComponent from "./Components/LogIn/LogInComponent";
import RegisterComponent from "./Components/Register/RegisterComponent";
import { AdminView } from "./Components/Admin";
import { useContext } from "react";
import { LoginContext } from "./Context/AuthContext";
import { SecretComponent } from "./Components/Secret/SecretComponent";
import Navbar from "./Components/NavBar/NavBar";
import UserSetting from "./Components/UserSetting/UserSetting";
import GameModeSelection from "./Components/Quiz/GameModeSelection";
import CompetitionComponent from "./Components/Quiz/CompetitionComponent";

function App() {
  const { isLoggedIn, logout } = useContext(LoginContext);
  return (
    <div className="App">
      <Navbar />
      <NavLink to="/"></NavLink>
      <NavLink to="gamemodel"></NavLink>
      <NavLink to="results"></NavLink>
      <NavLink to="leaderboard"></NavLink>
      <NavLink to="submit-fact"></NavLink>
      <NavLink to="login"></NavLink>
      <NavLink to="register"></NavLink>
      <NavLink to="usersetting"></NavLink>
      <NavLink to="admin"></NavLink>
      <NavLink to="quiz"></NavLink>
      <NavLink to="competition"></NavLink>
      <div className="routes">
        <Routes>
          <Route path="/" element={<HomeComponent />}></Route>
          <Route path="gamemodel" element={<GameModeSelection />}></Route>
          <Route path="results" element={<ResultComponent />}></Route>
          <Route path="leaderboard" element={<LeaderboardComponent />}></Route>
          <Route path="submit-fact" element={<SubmitFactComponent />}></Route>
          <Route path="login" element={<LogInComponent />}></Route>
          <Route path="register" element={<RegisterComponent />}></Route>
          <Route path="usersetting" element={<UserSetting />}></Route>
          <Route path="admin/*" element={<AdminView />}></Route>
          <Route path="knowledge" element={<SecretComponent />}></Route>
          <Route path="quiz" element={<QuizComponent />}></Route>
          <Route path="competition" element={<CompetitionComponent />}></Route>
        </Routes>
      </div>
    </div>
  );
}

export default App;
