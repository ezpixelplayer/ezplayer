import './WelcomeCard.css';

export interface WelcomeCardProps {
    className?: string;
}

export const WelcomeCard = ({ className = '' }: WelcomeCardProps) => {
    return (
        <div className={`welcome-card ${className}`}>
            <h1 className="welcome-card__title">Welcome to EZPlayer</h1>
            <p className="welcome-card__message">
                Your React web application is ready!
            </p>
        </div>
    );
};

