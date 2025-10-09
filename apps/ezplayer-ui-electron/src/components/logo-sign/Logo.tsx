import { Container } from '@mui/material';
import logo from '../../assets/images/ezplay.png';

// TODO CRAZ this is here because of the bundler and file name; also may look different / have different needs in other apps.
export const Logo = () => {
    return (
        <>
            <Container>
                <img height={'35px'} className="logoIMG" src={logo} alt="Logo" />
            </Container>
        </>
    );
};
