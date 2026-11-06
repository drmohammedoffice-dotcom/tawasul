import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { installNativeBackHandler } from './nativeBack';
/** Captures Android hardware back inside React Router. */
export function NativeBackBridge() {
    const navigate = useNavigate();
    const location = useLocation();
    const pathRef = useRef(location.pathname);
    pathRef.current = location.pathname;
    useEffect(() => {
        return installNativeBackHandler(navigate, () => pathRef.current);
    }, [navigate]);
    return null;
}
